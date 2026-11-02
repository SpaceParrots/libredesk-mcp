/**
 * @module bootstrap
 * Prepares the local LibreDesk dev stack for live tests: logs in as the system user, creates
 * the agent ldesk-dev@example.com (Admin role) if missing, generates a fresh API key and prints
 * the three LIBREDESK_* lines. The same lines are written to .env.live in the repo root.
 */

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const url = (process.env.LD_URL ?? "http://localhost:9000").replace(/\/+$/, "");
const password = process.env.LIBREDESK_SYSTEM_USER_PASSWORD ?? "ldesk-dev-Password1";
const AGENT_EMAIL = "ldesk-dev@example.com";
const HEALTH_TIMEOUT_MS = 120_000;

const log = (message) => console.error(`[bootstrap] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/health`)).status === 200) return;
    } catch {
      // Server not up yet.
    }
    await sleep(2000);
  }
  throw new Error(`${url}/health did not return 200 within ${HEALTH_TIMEOUT_MS / 1000}s`);
}

/** Session client: keeps the session cookie and sends a self-chosen CSRF token pair. */
function sessionClient() {
  const csrf = randomBytes(16).toString("hex");
  let sessionCookie = "";
  return {
    setSession(response) {
      const cookies = response.headers.getSetCookie().map((c) => c.split(";")[0]);
      sessionCookie = cookies.filter((c) => !c.startsWith("csrf_token=")).join("; ");
    },
    async call(method, path, body) {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Cookie: [sessionCookie, `csrf_token=${csrf}`].filter(Boolean).join("; "),
          "X-CSRFTOKEN": csrf,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
      return { response, data: JSON.parse(text).data };
    },
  };
}

async function main() {
  log(`waiting for ${url}/health`);
  await waitForHealth();

  const client = sessionClient();
  const login = await client.call("POST", "/api/v1/auth/login", { email: "System", password });
  client.setSession(login.response);
  log("logged in as System");

  const agents = (await client.call("GET", "/api/v1/agents")).data;
  let agent = agents.find((a) => a.email === AGENT_EMAIL);
  if (agent) {
    log(`agent ${AGENT_EMAIL} exists (id ${agent.id}), regenerating its API key`);
  } else {
    agent = (
      await client.call("POST", "/api/v1/agents", {
        first_name: "Ldesk",
        last_name: "Dev",
        email: AGENT_EMAIL,
        roles: ["Admin"],
        teams: [],
        enabled: true,
        send_welcome_email: false,
      })
    ).data;
    log(`created agent ${AGENT_EMAIL} (id ${agent.id})`);
  }

  const key = (await client.call("POST", `/api/v1/agents/${agent.id}/api-key`)).data;
  const lines = [`LIBREDESK_URL=${url}`, `LIBREDESK_API_KEY=${key.api_key}`, `LIBREDESK_API_SECRET=${key.api_secret}`];
  writeFileSync(new URL("../.env.live", import.meta.url), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
  log("wrote .env.live; to use the CLI run ldesk login with the url, key and secret printed above");
}

main().catch((error) => {
  console.error(`[bootstrap] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
