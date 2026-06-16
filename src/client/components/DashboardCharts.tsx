import { useMemo } from "react";
import type { Issue } from "../api";
import { riskColor, typeLabel } from "../utils";

type Props = {
  issues: Issue[];
};

export function DashboardCharts({ issues }: Props) {
  const analyzedIssues = useMemo(
    () => issues.filter((i) => i.analyzed_at),
    [issues],
  );
  const totalAnalyzed = analyzedIssues.length;

  // 1. Calcular tipos de issues
  const typeStats = useMemo(() => {
    const counts = { bug: 0, feature: 0, docs: 0, question: 0, other: 0 };
    analyzedIssues.forEach((issue) => {
      const type = (issue.analysis_type || "other") as keyof typeof counts;
      if (counts[type] !== undefined) {
        counts[type]++;
      } else {
        counts["other"]++;
      }
    });

    const total = totalAnalyzed || 1;
    return Object.entries(counts).map(([type, count]) => {
      const percentage = Math.round((count / total) * 100);
      return { type, count, percentage };
    });
  }, [analyzedIssues, totalAnalyzed]);

  // 2. Calcular riesgos de issues
  const riskStats = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    analyzedIssues.forEach((issue) => {
      const risk = (issue.analysis_risk || "low") as keyof typeof counts;
      if (counts[risk] !== undefined) {
        counts[risk]++;
      }
    });

    const total = totalAnalyzed || 1;
    const highPct = counts.high / total;
    const medPct = counts.medium / total;
    const lowPct = counts.low / total;

    const circ = 2 * Math.PI * 36; // Radio 36, circunferencia ~226.2
    const highStroke = highPct * circ;
    const medStroke = medPct * circ;
    const lowStroke = lowPct * circ;

    const highOffset = 0;
    const medOffset = -highStroke;
    const lowOffset = -(highStroke + medStroke);

    return {
      counts,
      circ,
      highStroke,
      medStroke,
      lowStroke,
      highOffset,
      medOffset,
      lowOffset,
      percentages: {
        high: Math.round(highPct * 100),
        medium: Math.round(medPct * 100),
        low: Math.round(lowPct * 100),
      },
    };
  }, [analyzedIssues, totalAnalyzed]);

  // 3. Calcular actividad últimos 7 días
  const activityStats = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return {
        key: d.toISOString().split("T")[0]!,
        label: d.toLocaleDateString("es-ES", { weekday: "short" }),
      };
    });

    const counts = days.map((day) => {
      const count = issues.filter((issue) => {
        const dateStr = issue.seen_at || issue.created_at;
        return dateStr && dateStr.startsWith(day.key);
      }).length;
      return { ...day, count };
    });

    const maxCount = Math.max(...counts.map((c) => c.count), 1);

    // Generar coordenadas del SVG (ancho 280, alto 100)
    const padding = 15;
    const width = 280;
    const height = 100;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    const points = counts.map((c, i) => {
      const x = padding + (i / 6) * chartW;
      const y = padding + chartH - (c.count / maxCount) * chartH;
      return { x, y, ...c };
    });

    const pathData =
      points.length > 0
        ? `M ${points[0]!.x} ${points[0]!.y} ` +
          points
            .slice(1)
            .map((p) => `L ${p.x} ${p.y}`)
            .join(" ")
        : "";

    const fillData =
      points.length > 0
        ? `${pathData} L ${points[points.length - 1]!.x} ${height - padding} L ${points[0]!.x} ${height - padding} Z`
        : "";

    return { counts, points, pathData, fillData, maxCount };
  }, [issues]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      {/* 1. Tipos de Issues */}
      <div className="border border-[var(--color-ink-3)] bg-[var(--color-ink-1)] p-5 flex flex-col justify-between min-h-[200px]">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-4)] mb-4">
            // señales por tipo
          </div>
          {totalAnalyzed === 0 ? (
            <div className="text-xs text-[var(--color-fg-4)] italic py-8 text-center font-mono">
              Sin datos de análisis
            </div>
          ) : (
            <div className="space-y-2.5 font-mono text-xs py-1">
              {typeStats.map((stat) => (
                <div
                  key={stat.type}
                  className="flex items-center justify-between w-full"
                >
                  <span className="text-[var(--color-fg-2)] min-w-[70px] truncate text-[11px]">
                    {typeLabel(stat.type).toLowerCase()}
                  </span>

                  {/* Conector de puntos y barra de progreso fina */}
                  <div className="flex-1 mx-3 relative h-[6px] flex items-center">
                    <div className="absolute inset-x-0 h-px border-b border-dotted border-[var(--color-ink-4)]" />
                    <div
                      className="absolute left-0 h-[2px] bg-[var(--color-accent)] transition-all duration-500"
                      style={{ width: `${stat.percentage}%` }}
                    />
                  </div>

                  <span className="text-[var(--color-fg-4)] text-[11px] min-w-[55px] text-right whitespace-nowrap">
                    {stat.count} ({stat.percentage}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 2. Distribución de Riesgos */}
      <div className="border border-[var(--color-ink-3)] bg-[var(--color-ink-1)] p-5 flex flex-col justify-between min-h-[200px]">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-4)] mb-3">
            // criticidad llm
          </div>
          {totalAnalyzed === 0 ? (
            <div className="text-xs text-[var(--color-fg-4)] italic py-8 text-center font-mono">
              Sin datos de análisis
            </div>
          ) : (
            <div className="flex items-center gap-6 py-2">
              <div className="relative w-24 h-24 flex items-center justify-center">
                <svg
                  className="w-full h-full transform -rotate-90"
                  viewBox="0 0 80 80"
                >
                  <circle
                    cx="40"
                    cy="40"
                    r="36"
                    className="stroke-[var(--color-ink-3)] fill-none"
                    strokeWidth="7"
                  />
                  {/* Círculo Riesgo Bajo (Verde/Accent) */}
                  {riskStats.lowStroke > 0 && (
                    <circle
                      cx="40"
                      cy="40"
                      r="36"
                      className="stroke-[var(--color-accent)] fill-none transition-all duration-500"
                      strokeWidth="7"
                      strokeDasharray={`${riskStats.lowStroke} ${riskStats.circ}`}
                      strokeDashoffset={riskStats.lowOffset}
                    />
                  )}
                  {/* Círculo Riesgo Medio (Naranja/Warn) */}
                  {riskStats.medStroke > 0 && (
                    <circle
                      cx="40"
                      cy="40"
                      r="36"
                      className="stroke-[var(--color-warn)] fill-none transition-all duration-500"
                      strokeWidth="7"
                      strokeDasharray={`${riskStats.medStroke} ${riskStats.circ}`}
                      strokeDashoffset={riskStats.medOffset}
                    />
                  )}
                  {/* Círculo Riesgo Alto (Rojo/Danger) */}
                  {riskStats.highStroke > 0 && (
                    <circle
                      cx="40"
                      cy="40"
                      r="36"
                      className="stroke-[var(--color-danger)] fill-none transition-all duration-500"
                      strokeWidth="7"
                      strokeDasharray={`${riskStats.highStroke} ${riskStats.circ}`}
                      strokeDashoffset={riskStats.highOffset}
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center font-mono text-center">
                  <span className="text-lg font-bold text-[var(--color-fg-1)]">
                    {totalAnalyzed}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-[var(--color-fg-4)]">
                    analizados
                  </span>
                </div>
              </div>

              <div className="flex-1 space-y-2 font-mono text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[var(--color-danger)] border border-[var(--color-ink-3)]" />
                    <span className="text-[var(--color-fg-3)]">alto</span>
                  </div>
                  <span className="text-[var(--color-fg-2)] font-semibold">
                    {riskStats.counts.high}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[var(--color-warn)] border border-[var(--color-ink-3)]" />
                    <span className="text-[var(--color-fg-3)]">medio</span>
                  </div>
                  <span className="text-[var(--color-fg-2)] font-semibold">
                    {riskStats.counts.medium}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-[var(--color-accent)] border border-[var(--color-ink-3)]" />
                    <span className="text-[var(--color-fg-3)]">bajo</span>
                  </div>
                  <span className="text-[var(--color-fg-2)] font-semibold">
                    {riskStats.counts.low}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Sparkline de Actividad */}
      <div className="border border-[var(--color-ink-3)] bg-[var(--color-ink-1)] p-5 flex flex-col justify-between min-h-[200px]">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-4)] mb-4">
            // actividad de señales (7d)
          </div>
          <div className="relative h-24 w-full flex flex-col justify-end">
            {issues.length === 0 ? (
              <div className="text-xs text-[var(--color-fg-4)] italic py-8 text-center font-mono w-full">
                Sin señales de actividad
              </div>
            ) : (
              <>
                <svg
                  className="w-full h-full overflow-visible"
                  viewBox="0 0 280 100"
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--color-accent)"
                        stopOpacity="0.25"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--color-accent)"
                        stopOpacity="0.0"
                      />
                    </linearGradient>
                  </defs>

                  {/* Línea de cuadrícula media */}
                  <line
                    x1="15"
                    y1="50"
                    x2="265"
                    y2="50"
                    className="stroke-[var(--color-ink-3)] stroke-dasharray-[2_4]"
                    strokeWidth="1"
                    strokeDasharray="2 4"
                  />

                  {/* Relleno bajo la curva */}
                  {activityStats.fillData && (
                    <path
                      d={activityStats.fillData}
                      fill="url(#gradient)"
                      className="transition-all duration-500"
                    />
                  )}

                  {/* Curva Sparkline */}
                  {activityStats.pathData && (
                    <path
                      d={activityStats.pathData}
                      fill="none"
                      className="stroke-[var(--color-accent)] transition-all duration-500"
                      strokeWidth="2"
                    />
                  )}

                  {/* Puntos interactivos / Nodos */}
                  {activityStats.points.map((p, index) => (
                    <g key={index} className="group/node">
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r="3"
                        className="fill-[var(--color-ink-1)] stroke-[var(--color-accent)] cursor-pointer hover:r-4 transition-all"
                        strokeWidth="1.5"
                      />
                      {/* Tooltip pequeño */}
                      <text
                        x={p.x}
                        y={p.y - 8}
                        className="fill-[var(--color-accent)] font-mono text-[9px] text-center opacity-0 group-hover/node:opacity-100 transition-opacity font-semibold"
                        textAnchor="middle"
                      >
                        {p.count}
                      </text>
                    </g>
                  ))}
                </svg>

                {/* Etiquetas de Días */}
                <div className="flex justify-between mt-2 font-mono text-[9px] text-[var(--color-fg-4)] px-1 select-none">
                  {activityStats.counts.map((c, i) => (
                    <span key={i}>{c.label}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
