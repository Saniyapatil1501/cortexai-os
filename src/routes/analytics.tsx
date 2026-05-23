import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Stat } from "@/components/cortex/ui";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — CortexAI" },
      { name: "description", content: "Deep insights into your focus, study, and coding patterns." },
    ],
  }),
  component: AnalyticsPage,
});

import { useEffect, useState } from "react";
import { cortexClient } from "@/lib/api";

const defaultTrend = Array.from({ length: 14 }, (_, i) => ({
  day: `D${i + 1}`,
  focus: 2 + Math.sin(i / 2) * 1.5,
  distraction: 1.0
}));

const defaultHours = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => ({
  d,
  code: 1 + Math.random() * 4,
  study: 0.5 + Math.random() * 3,
}));

const defaultDistr = Array.from({ length: 12 }, (_, i) => ({ d: i + 1, v: Math.round(2 + Math.random() * 9) }));

const defaultHeatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => Math.random()));

const tooltipStyle = {
  background: "rgba(20,20,22,0.95)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  fontSize: 12,
};

function AnalyticsPage() {
  const [summary, setSummary] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>(defaultTrend);
  const [hours, setHours] = useState<any[]>(defaultHours);
  const [distr, setDistr] = useState<any[]>(defaultDistr);
  const [heatmap, setHeatmap] = useState<number[][]>(defaultHeatmap);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      cortexClient.getActivitySummary(1),
      cortexClient.getProductivityAnalytics(1),
      cortexClient.getWeeklyHoursAnalytics(1),
      cortexClient.getDistractionsAnalytics(1),
      cortexClient.getHeatmapAnalytics(1)
    ]).then(([sum, trendData, hoursData, distrData, heatmapData]) => {
      setSummary(sum);
      if (trendData && trendData.length > 0) setTrend(trendData);
      if (hoursData && hoursData.length > 0) setHours(hoursData);
      if (distrData && distrData.length > 0) setDistr(distrData);
      if (heatmapData && heatmapData.length > 0) setHeatmap(heatmapData);
      setLoading(false);
    }).catch((err) => {
      console.error("Error loading analytics data:", err);
      setLoading(false);
    });
  }, []);

  const getTotalFocusHours = () => {
    if (!summary?.total_seconds) return "0h";
    const codeSecs = summary.categories?.code || 0;
    const studySecs = summary.categories?.study || 0;
    return `${Math.round((codeSecs + studySecs) / 3600)}h`;
  };

  const getDeepWorkRatio = () => {
    if (!summary?.total_seconds) return "0%";
    const codeSec = summary.categories?.code || 0;
    const studySec = summary.categories?.study || 0;
    const totalSec = summary.total_seconds || 1;
    const ratio = Math.round((codeSec + studySec) / totalSec * 100);
    return `${ratio}%`;
  };

  const getDistractionsCount = () => {
    if (!summary) return "0";
    // Count distraction logs
    return String(summary.categories?.distraction ? Math.round(summary.categories.distraction / 10) : 0);
  };

  return (
    <AppLayout>
      <PageHeader title="Analytics" description="How you actually spend your attention." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total focus" value={getTotalFocusHours()} hint="this week" trend={{ value: "+12%", up: true }} />
        <Stat label="Avg session" value="50m" hint="streak builder" />
        <Stat label="Deep work ratio" value={getDeepWorkRatio()} hint="of total work time" trend={{ value: "+8%", up: true }} />
        <Stat label="Distractions" value={getDistractionsCount()} hint="this week" trend={{ value: "-21%", up: true }} />
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="mb-4">
            <div className="text-sm font-medium">Productivity trend</div>
            <div className="text-xs text-muted-foreground">Score · last 14 days</div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="white" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="white" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="day" stroke="rgba(255,255,255,0.35)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.35)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="focus" stroke="white" strokeWidth={1.5} fill="url(#ga)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <div className="mb-4">
            <div className="text-sm font-medium">Coding vs study</div>
            <div className="text-xs text-muted-foreground">hours / day</div>
          </div>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={hours} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="d" stroke="rgba(255,255,255,0.35)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.35)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Bar dataKey="code" stackId="a" fill="white" radius={[2, 2, 0, 0]} />
                <Bar dataKey="study" stackId="a" fill="rgba(255,255,255,0.35)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="mb-4">
            <div className="text-sm font-medium">Distractions</div>
            <div className="text-xs text-muted-foreground">last 12 days</div>
          </div>
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={distr} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="d" stroke="rgba(255,255,255,0.35)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.35)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="v" stroke="white" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <div className="text-sm font-medium">Attention heatmap</div>
              <div className="text-xs text-muted-foreground">when you focus best</div>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              less
              <span className="ml-1 h-3 w-3 rounded-sm bg-white/10" />
              <span className="h-3 w-3 rounded-sm bg-white/25" />
              <span className="h-3 w-3 rounded-sm bg-white/50" />
              <span className="h-3 w-3 rounded-sm bg-white/80" />
              more
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="grid grid-rows-7 gap-1 min-w-[640px]">
              {heatmap.map((row, ri) => (
                <div key={ri} className="grid grid-cols-24 gap-1" style={{ gridTemplateColumns: "repeat(24, minmax(0,1fr))" }}>
                  {row.map((v, ci) => (
                    <div
                      key={ci}
                      className="h-5 rounded-sm"
                      style={{ background: `rgba(255,255,255,${0.05 + v * 0.75})` }}
                      title={`${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][ri]} · ${ci}:00`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
