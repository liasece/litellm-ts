import { useEffect, useMemo, useState } from "react";
import { Alert, Button } from "antd";
import {
  CheckOutlined,
  CopyOutlined,
  LeftOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { Bot, Sparkles, Wrench } from "lucide-react";
import { LogEntry, type SessionGroupRef } from "../columns";
import { AGENT_CALL_TYPES, MCP_CALL_TYPES } from "../constants";
import { getEventDisplayName } from "../utils";
import { DrawerHeader } from "./DrawerHeader";
import { useKeyboardNavigation } from "./useKeyboardNavigation";
import { LogDetailContent, GuardrailJumpLink } from "./LogDetailContent";
import { sessionSpendLogsCall } from "../../networking";
import { useQuery } from "@tanstack/react-query";
import { formatNumberWithCommas, getSpendString } from "@/utils/dataUtils";
import { normalizeGuardrailEntries } from "./utils";
import { useLogDetails } from "@/app/(dashboard)/hooks/logDetails/useLogDetails";
import SidePanel from "../../common_components/SidePanel";

export interface LogDetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  logEntry: LogEntry | null;
  sessionGroup?: SessionGroupRef | null;
  teamId?: string;
  accessToken?: string | null;
  onOpenSettings?: () => void;
  allLogs?: LogEntry[];
  onSelectLog?: (log: LogEntry) => void;
  startTime?: string;
}

const SIDEBAR_WIDTH_PX = 224;
const SESSION_LOG_PAGE_SIZE = 100;
const MAX_SESSION_LOG_PAGES = 1000;

/* ------------------------------------------------------------------ */
/*  TraceEventRow — compact event row used in both session & non-     */
/*  session sidebar lists.  Extracted to avoid JSX duplication.       */
/* ------------------------------------------------------------------ */
interface TraceEventRowProps {
  row: LogEntry;
  isSelected: boolean;
  onClick: () => void;
}

function TraceEventRow({ row, isSelected, onClick }: TraceEventRowProps) {
  const isMcp = MCP_CALL_TYPES.includes(row.call_type);
  const isAgent = AGENT_CALL_TYPES.includes(row.call_type);
  const durationValue =
    row.request_duration_ms != null
      ? (row.request_duration_ms / 1000).toFixed(3)
      : row.startTime && row.endTime
        ? ((Date.parse(row.endTime) - Date.parse(row.startTime)) / 1000).toFixed(3)
        : "-";

  return (
    <button
      type="button"
      className={`w-full text-left pl-8 pr-2 py-1 transition-colors ${
        isSelected ? "bg-blue-50" : "hover:bg-slate-100"
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-1">
        {isMcp ? (
          <Wrench size={12} className="text-slate-500 flex-shrink-0" />
        ) : isAgent ? (
          <Bot size={12} className="text-slate-500 flex-shrink-0" />
        ) : (
          <Sparkles size={12} className="text-slate-500 flex-shrink-0" />
        )}
        <span className="text-xs font-medium text-slate-900 truncate">
          {getEventDisplayName(row.call_type, row.model)}
        </span>
      </div>
      <div className="text-[10px] text-slate-500 mt-0 flex items-center gap-1.5 font-mono">
        <span>{durationValue}s</span>
        {row.spend ? (
          <>
            <span>·</span>
            <span>{getSpendString(row.spend)}</span>
          </>
        ) : null}
        {row.total_tokens ? (
          <>
            <span>·</span>
            <span>{formatNumberWithCommas(row.total_tokens, 0, false)} tok</span>
          </>
        ) : null}
      </div>
    </button>
  );
}

/**
 * Right-side drawer panel for displaying detailed log information.
 * Features:
 * - Request ID prominently displayed with copy functionality
 * - Keyboard navigation (J/K for next/prev, Escape to close)
 * - Formatted and JSON view toggle for request/response
 * - Smart display of cache fields (hidden when zero)
 * - Error alerts for failed requests
 * - Collapsible sections for guardrails, vector store, metadata
 */
export function LogDetailsDrawer({
  open,
  onClose,
  logEntry,
  sessionGroup,
  teamId,
  accessToken,
  onOpenSettings,
  allLogs = [],
  onSelectLog,
  startTime,
}: LogDetailsDrawerProps) {
  const isSessionMode = Boolean(sessionGroup);
  const [selectedSessionRequestId, setSelectedSessionRequestId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [copiedLeftPanelId, setCopiedLeftPanelId] = useState(false);

  const {
    data: loadedSessionLogs = [],
    isError: isSessionError,
    error: sessionError,
    refetch: refetchSessionLogs,
    isFetching: isFetchingSessionLogs,
    isLoading: isLoadingSessionLogs,
  } = useQuery({
    queryKey: ["sessionLogs", sessionGroup?.type, sessionGroup?.id, teamId],
    queryFn: async () => {
      if (!sessionGroup || !accessToken) return [];
      const firstPage = await sessionSpendLogsCall(accessToken, sessionGroup, {
        pageSize: SESSION_LOG_PAGE_SIZE,
        teamId,
      });
      const allSessionLogs: LogEntry[] = [...(firstPage.data || firstPage || [])];
      const expectedTotal =
        !Array.isArray(firstPage) && Number.isSafeInteger(firstPage.total) && Number(firstPage.total) >= 0
          ? Number(firstPage.total)
          : null;
      if (!Array.isArray(firstPage) && firstPage.next_cursor) {
        let snapshot = typeof firstPage.snapshot === "string" && firstPage.snapshot ? firstPage.snapshot : undefined;
        let cursor = firstPage.next_cursor;
        if (!snapshot) throw new Error("Session logs response contains invalid snapshot");
        for (let pageCount = 1; cursor; pageCount += 1) {
          if (pageCount >= MAX_SESSION_LOG_PAGES) {
            throw new Error("Session logs response exceeds pagination limit");
          }
          const response = await sessionSpendLogsCall(accessToken, sessionGroup, {
            pageSize: SESSION_LOG_PAGE_SIZE,
            teamId,
            snapshot,
            cursor,
          });
          allSessionLogs.push(...(response.data || response || []));
          snapshot = typeof response.snapshot === "string" && response.snapshot ? response.snapshot : snapshot;
          cursor = typeof response.next_cursor === "string" ? response.next_cursor : "";
        }
      } else if (!Array.isArray(firstPage)) {
        const totalPages = firstPage.total_pages ?? 1;
        if (
          !Number.isSafeInteger(totalPages) ||
          totalPages < (allSessionLogs.length > 0 ? 1 : 0) ||
          totalPages > MAX_SESSION_LOG_PAGES
        ) {
          throw new Error("Session logs response contains invalid total_pages");
        }
        for (let page = 2; page <= totalPages; page += 1) {
          const response = await sessionSpendLogsCall(accessToken, sessionGroup, {
            page,
            pageSize: SESSION_LOG_PAGE_SIZE,
            teamId,
          });
          allSessionLogs.push(...(response.data || response || []));
        }
      }
      const uniqueSessionLogs = Array.from(
        new Map(allSessionLogs.map((row) => [row.request_id, row])).values(),
      );
      if (expectedTotal !== null && uniqueSessionLogs.length !== expectedTotal) {
        throw new Error(`Session logs incomplete: loaded ${uniqueSessionLogs.length} of ${expectedTotal}`);
      }
      return uniqueSessionLogs
        .map((row) => ({
          ...row,
          request_duration_ms: row.request_duration_ms ?? (Date.parse(row.endTime) - Date.parse(row.startTime)),
        }))
        .sort((a, b) => {
          const timeDifference = new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
          return timeDifference !== 0 ? timeDifference : b.request_id.localeCompare(a.request_id);
        });
    },
    enabled: Boolean(open && isSessionMode && sessionGroup && accessToken),
  });

  const sessionLogs = useMemo(
    () => (loadedSessionLogs.length > 0 ? loadedSessionLogs : logEntry ? [logEntry] : []),
    [loadedSessionLogs, logEntry],
  );

  const currentLog = useMemo(() => {
    if (!isSessionMode) return logEntry;
    if (!sessionLogs.length) return null;
    if (selectedSessionRequestId) {
      return sessionLogs.find((row) => row.request_id === selectedSessionRequestId) || sessionLogs[0];
    }
    if (logEntry?.request_id) {
      const clickedLog = sessionLogs.find((row) => row.request_id === logEntry.request_id);
      return clickedLog || sessionLogs[0];
    }
    return sessionLogs[0];
  }, [isSessionMode, logEntry, selectedSessionRequestId, sessionLogs]);

  useEffect(() => {
    if (!isSessionMode || !sessionLogs.length) return;
    if (!selectedSessionRequestId || !sessionLogs.some((row) => row.request_id === selectedSessionRequestId)) {
      const fallbackRequestId = logEntry?.request_id && sessionLogs.some((row) => row.request_id === logEntry.request_id)
        ? logEntry.request_id
        : sessionLogs[0].request_id;
      setSelectedSessionRequestId(fallbackRequestId);
    }
  }, [isSessionMode, logEntry, selectedSessionRequestId, sessionLogs]);

  // Reset transient UI state when the drawer opens or closes.
  useEffect(() => {
    if (open) {
      setIsSidebarCollapsed(false);
    } else {
      if (isSessionMode) setSelectedSessionRequestId(null);
      setCopiedLeftPanelId(false);
    }
  }, [open, isSessionMode]);

  // Keyboard navigation
  const { selectNextLog, selectPreviousLog } = useKeyboardNavigation({
    isOpen: open,
    currentLog,
    allLogs: isSessionMode ? sessionLogs : allLogs,
    onClose,
    onSelectLog: (selected) => {
      if (isSessionMode) {
        setSelectedSessionRequestId(selected.request_id);
      }
      onSelectLog?.(selected);
    },
  });

  // Lazy-load log details (messages/response) only when drawer is open.
  // This fetches data for a single log on-demand instead of prefetching all 50.
  const logDetails = useLogDetails(currentLog?.request_id, startTime, open && !!currentLog?.request_id);
  const detailsData = logDetails.data as any;
  const isLoadingDetails = logDetails.isLoading;

  // Build an enriched log entry that merges lazy-loaded details.
  // The list endpoint may already include messages/response when store_prompts_in_spend_logs is enabled,
  // while the detail endpoint fetches from custom loggers (S3, GCS, etc.) or DB fallback.
  const enrichedLog = useMemo(() => {
    if (!currentLog) return null;
    return {
      ...currentLog,
      messages: detailsData?.messages || currentLog.messages,
      response: detailsData?.response || currentLog.response,
      proxy_server_request: detailsData?.proxy_server_request || currentLog.proxy_server_request,
    };
  }, [currentLog, detailsData]);

  const metadata = currentLog?.metadata || {};

  // Status display values
  const statusLabel = metadata.status === "failure" ? "Failure" : "Success";
  const statusColor = metadata.status === "failure" ? ("error" as const) : ("success" as const);
  const environment = metadata?.user_api_key_team_alias || "default";
  const rawSessionErrorMessage = sessionError instanceof Error ? sessionError.message : "Unknown error";
  const sessionErrorMessage = /^\s*(?:<!doctype\s+html|<html)\b/i.test(rawSessionErrorMessage)
    ? "Session logs request failed"
    : rawSessionErrorMessage.slice(0, 300);

  const totalSessionCost = sessionLogs.reduce((sum, row) => sum + (row.spend || 0), 0);
  const sessionStart = sessionLogs.length > 0
    ? new Date(Math.min(...sessionLogs.map((r) => new Date(r.startTime).getTime())))
    : null;
  const sessionEnd = sessionLogs.length > 0
    ? new Date(Math.max(...sessionLogs.map((r) => new Date(r.endTime).getTime())))
    : null;
  const sessionDurationSeconds =
    sessionStart && sessionEnd ? ((sessionEnd.getTime() - sessionStart.getTime()) / 1000).toFixed(2) : "0.00";
  const llmCount = sessionLogs.filter(
    (row) => !MCP_CALL_TYPES.includes(row.call_type) && !AGENT_CALL_TYPES.includes(row.call_type),
  ).length;
  const agentCount = sessionLogs.filter((row) => AGENT_CALL_TYPES.includes(row.call_type)).length;
  const mcpCount = sessionLogs.filter((row) => MCP_CALL_TYPES.includes(row.call_type)).length;
  const logsForList = isSessionMode ? sessionLogs : currentLog ? [currentLog] : [];
  const leftPanelId = isSessionMode ? sessionGroup?.id || "" : currentLog?.request_id || "";
  const leftPanelDisplayId =
    leftPanelId.length > 14 ? `${leftPanelId.slice(0, 11)}...` : leftPanelId;

  const handleCopyLeftPanelId = async () => {
    if (!leftPanelId) return;
    try {
      await navigator.clipboard.writeText(leftPanelId);
      setCopiedLeftPanelId(true);
      setTimeout(() => setCopiedLeftPanelId(false), 1200);
    } catch { /* clipboard unavailable in non-secure contexts */ }
  };

  if (!currentLog || !enrichedLog) return null;

  return (
    <SidePanel
      title={null}
      onClose={onClose}
      open={open}
      closable={false}
      mask={true}
      maskClosable={true}
      styles={{
        body: { padding: 0, overflow: "hidden" },
        header: { display: "none" },
      }}
    >
      <div style={{ height: "100%" }} className="flex relative">
          {!isSidebarCollapsed ? (
            <Button
              type="text"
              size="small"
              icon={<LeftOutlined />}
              onClick={() => setIsSidebarCollapsed(true)}
              className="absolute top-2 left-2 z-20 !bg-white !border !border-slate-200 !rounded-md"
              aria-label="Collapse trace sidebar"
            />
          ) : (
            <Button
              type="text"
              size="small"
              icon={<RightOutlined />}
              onClick={() => setIsSidebarCollapsed(false)}
              className="absolute top-2 left-2 z-20 !bg-white !border !border-slate-200 !rounded-md"
              aria-label="Expand trace sidebar"
            />
          )}
          {!isSidebarCollapsed && (
          <div
            className="border-r border-slate-200 bg-slate-50 flex flex-col"
            style={{ width: SIDEBAR_WIDTH_PX }}
          >
            <div className="pl-12 pr-3 py-2 border-b border-slate-200 bg-white">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-slate-500">
                    {isSessionMode ? "Session" : "Trace"}
                  </div>
                  <div className="font-mono text-[12px] text-slate-900 leading-tight flex items-center gap-1">
                    <span className="truncate">{leftPanelDisplayId}</span>
                    <button
                      type="button"
                      onClick={handleCopyLeftPanelId}
                      className="text-slate-400 hover:text-slate-600"
                      aria-label="Copy trace id"
                    >
                      {copiedLeftPanelId ? (
                        <CheckOutlined className="text-[11px]" />
                      ) : (
                        <CopyOutlined className="text-[11px]" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-500 font-mono">
                {isSessionMode && isLoadingSessionLogs ? (
                  <span>Loading all session logs…</span>
                ) : (
                  <>
                    {logsForList.length} req
                    {[
                      isSessionMode
                        ? llmCount
                        : logsForList.filter(
                            (row) =>
                              !MCP_CALL_TYPES.includes(row.call_type) && !AGENT_CALL_TYPES.includes(row.call_type),
                          ).length,
                      isSessionMode
                        ? agentCount
                        : logsForList.filter((row) => AGENT_CALL_TYPES.includes(row.call_type)).length,
                      isSessionMode ? mcpCount : logsForList.filter((row) => MCP_CALL_TYPES.includes(row.call_type)).length,
                    ].map((count, i) => {
                      const label = [" LLM", " Agent", " MCP"][i];
                      return count > 0 ? (
                        <span key={label}>
                          <span className="mx-1.5">·</span>
                          {count}
                          {label}
                        </span>
                      ) : null;
                    })}
                    <span className="mx-1.5">·</span>
                    {isSessionMode ? getSpendString(totalSessionCost) : getSpendString(currentLog.spend || 0)}
                    {isSessionMode && (
                      <>
                        <span className="mx-1.5">·</span>
                        {sessionDurationSeconds}s
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {normalizeGuardrailEntries(metadata?.guardrail_information).length > 0 && (
                <div className="px-3 pt-2">
                  <GuardrailJumpLink guardrailEntries={normalizeGuardrailEntries(metadata?.guardrail_information)} />
                </div>
              )}
              {isSessionMode ? (
                <div className="py-1">
                  {/* Child events — vertical tree line with horizontal connectors */}
                  <div className="relative pl-2">
                    <div className="absolute left-4 top-1 bottom-1 border-l border-slate-300" />
                    {logsForList.map((row, idx) => {
                      const isLast = idx === logsForList.length - 1;
                      return (
                        <div key={row.request_id} className="relative">
                          <div className="absolute left-4 top-3 w-3 border-t border-slate-300" />
                          {isLast && <div className="absolute left-4 top-3 bottom-0 w-px bg-slate-50" />}
                          <TraceEventRow
                            row={row}
                            isSelected={row.request_id === currentLog.request_id}
                            onClick={() => {
                              setSelectedSessionRequestId(row.request_id);
                              onSelectLog?.(row);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="py-1">
                  {logsForList.map((row) => (
                    <TraceEventRow
                      key={row.request_id}
                      row={row}
                      isSelected={row.request_id === currentLog.request_id}
                      onClick={() => onSelectLog?.(row)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          )}

          <div className="flex-1 flex flex-col overflow-hidden">
            <DrawerHeader
              log={currentLog}
              onClose={onClose}
              onPrevious={selectPreviousLog}
              onNext={selectNextLog}
              statusLabel={statusLabel}
              statusColor={statusColor}
              environment={environment}
            />
            {isSessionMode && isSessionError ? (
              <Alert
                type="warning"
                showIcon={true}
                message="完整 Session 加载失败"
                description={`当前仅显示单请求。${sessionErrorMessage}`}
                action={
                  <Button
                    size="small"
                    onClick={() => void refetchSessionLogs()}
                    loading={isFetchingSessionLogs}
                    disabled={isFetchingSessionLogs}
                  >
                    Retry
                  </Button>
                }
              />
            ) : null}
            <div className="flex-1 overflow-y-auto">
              <LogDetailContent
                logEntry={enrichedLog}
                onOpenSettings={onOpenSettings}
                isLoadingDetails={isLoadingDetails}
                accessToken={accessToken ?? null}
              />
            </div>
          </div>
        </div>
    </SidePanel>
  );
}
