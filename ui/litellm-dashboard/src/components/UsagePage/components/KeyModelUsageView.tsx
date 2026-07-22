import { formatNumberWithCommas } from "@/utils/dataUtils";
import { BarChart, Card, Title } from "@tremor/react";
import { Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import React, { useState } from "react";
import { TopModelData } from "../types";

interface KeyModelUsageViewProps {
  topModels: TopModelData[];
}

const VISIBLE_ROWS = 5;
const CHART_ROW_HEIGHT = 40;
const CHART_VERTICAL_PADDING = 34;
// antd Table with size="small" has a row height of ~39px
const ANTD_SMALL_TABLE_ROW_HEIGHT = 39;

const columns: ColumnsType<TopModelData> = [
  {
    title: "Model",
    dataIndex: "model",
    key: "model",
    render: (value) => value || "-",
  },
  {
    title: "Spend (USD)",
    dataIndex: "spend",
    key: "spend",
    render: (value) => `$${formatNumberWithCommas(value, 2)}`,
  },
  {
    title: "Requests",
    dataIndex: "requests",
    key: "requests",
    render: (value) => value?.toLocaleString() || 0,
  },
  {
    title: "Successful",
    dataIndex: "successful_requests",
    key: "successful_requests",
    render: (value) => <span className="text-green-600">{value?.toLocaleString() || 0}</span>,
  },
  {
    title: "Failed",
    dataIndex: "failed_requests",
    key: "failed_requests",
    render: (value) => <span className="text-red-600">{value?.toLocaleString() || 0}</span>,
  },
  {
    title: "Tokens",
    dataIndex: "tokens",
    key: "tokens",
    render: (value) => formatNumberWithCommas(value ?? 0, 0, false),
  },
];

const KeyModelUsageView: React.FC<KeyModelUsageViewProps> = ({ topModels }) => {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const topModelsBySpend = [...topModels].sort((a, b) => b.spend - a.spend);
  const topModelsByTokens = [...topModels].sort((a, b) => b.tokens - a.tokens);

  if (topModelsBySpend.length === 0) {
    return null;
  }

  return (
    <Card className="mt-4">
      <div className="flex justify-between items-center mb-3">
        <Title>Model Usage</Title>
        <div className="flex space-x-2">
          <button
            onClick={() => setViewMode("table")}
            className={`px-3 py-1 text-sm rounded-md ${viewMode === "table" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode("chart")}
            className={`px-3 py-1 text-sm rounded-md ${viewMode === "chart" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-700"}`}
          >
            Chart
          </button>
        </div>
      </div>
      {viewMode === "chart" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <Title>Top Models by Spend</Title>
            <div className="mt-3 max-h-[234px] overflow-y-auto">
              <BarChart
                style={{ height: topModelsBySpend.length * CHART_ROW_HEIGHT + CHART_VERTICAL_PADDING }}
                data={topModelsBySpend.map((model) => ({ key: model.model, spend: model.spend }))}
                index="key"
                categories={["spend"]}
                colors={["cyan"]}
                valueFormatter={(value) => `$${formatNumberWithCommas(value, 2)}`}
                layout="vertical"
                yAxisWidth={180}
                tickGap={5}
                showLegend={false}
              />
            </div>
          </div>
          <div className="min-w-0">
            <Title>Top Models by Tokens</Title>
            <div className="mt-3 max-h-[234px] overflow-y-auto">
              <BarChart
                style={{ height: topModelsByTokens.length * CHART_ROW_HEIGHT + CHART_VERTICAL_PADDING }}
                data={topModelsByTokens.map((model) => ({ key: model.model, tokens: model.tokens }))}
                index="key"
                categories={["tokens"]}
                colors={["indigo"]}
                valueFormatter={(value) => formatNumberWithCommas(value, 0, false)}
                layout="vertical"
                yAxisWidth={180}
                tickGap={5}
                showLegend={false}
              />
            </div>
          </div>
        </div>
      ) : (
        <Table
          columns={columns}
          dataSource={topModelsBySpend}
          rowKey="model"
          size="small"
          pagination={false}
          scroll={
            topModelsBySpend.length > VISIBLE_ROWS
              ? { y: VISIBLE_ROWS * ANTD_SMALL_TABLE_ROW_HEIGHT }
              : undefined
          }
        />
      )}
    </Card>
  );
};

export default KeyModelUsageView;
