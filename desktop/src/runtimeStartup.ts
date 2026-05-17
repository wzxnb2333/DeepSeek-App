export type StartupPayload = {
  auth_required: boolean;
  auth_token: string | null;
  base_url: string;
  port: number;
  status: "ready";
};

function isStartupPayload(value: unknown): value is StartupPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<StartupPayload>;
  return (
    candidate.status === "ready" &&
    typeof candidate.base_url === "string" &&
    typeof candidate.port === "number" &&
    typeof candidate.auth_required === "boolean"
  );
}

export function parseStartupPayloadLine(line: string): StartupPayload | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isStartupPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
