interface SearchParamsReader {
  get(name: string): string | null;
}

const PATH_PAGE_MAP: Readonly<Record<string, string>> = {
  "api-reference": "api-reference",
  guardrails: "guardrails",
  logs: "logs",
  "model-hub": "model-hub-table",
  "models-and-endpoints": "models",
  organizations: "organizations",
  playground: "llm-playground",
  policies: "policies",
  teams: "teams",
  usage: "new_usage",
  users: "users",
  "virtual-keys": "api-keys",
};

function relativeDashboardPath(pathname: string, basePrefix: string): string {
  const normalizedPath = `/${pathname.replace(/^\/+|\/+$/g, "")}`;
  const normalizedBase = `/${basePrefix.replace(/^\/+|\/+$/g, "")}`;

  if (normalizedBase !== "/" && normalizedPath === normalizedBase) {
    return "";
  }

  if (normalizedBase !== "/" && normalizedPath.startsWith(`${normalizedBase}/`)) {
    return normalizedPath.slice(normalizedBase.length + 1);
  }

  return normalizedPath.slice(1);
}

export function deriveDashboardPage(
  pathname: string,
  searchParams: SearchParamsReader,
  basePrefix = "",
): string {
  const [routeSegment = ""] = relativeDashboardPath(pathname, basePrefix).split("/");
  return PATH_PAGE_MAP[routeSegment.toLowerCase()] ?? searchParams.get("page") ?? "api-keys";
}
