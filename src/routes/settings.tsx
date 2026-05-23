import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Button } from "@/components/cortex/ui";
import { useState } from "react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — CortexAI" },
      { name: "description", content: "Tune Cortex to your workflow." },
    ],
  }),
  component: SettingsPage,
});

const tabs = ["Account", "Appearance", "AI", "Voice", "Notifications", "Goals"] as const;

function SettingsPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Account");

  return (
    <AppLayout>
      <PageHeader title="Settings" description="Configure your CortexAI workspace." />

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        <Card padded={false}>
          <nav className="p-2">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                  tab === t ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-surface-2/60"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </Card>

        <div className="space-y-4">
          {tab === "Account" && (
            <>
              <Card>
                <SectionHeader title="Profile" desc="Update your personal details." />
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Name" defaultValue="Alex Kim" />
                  <Field label="Email" defaultValue="alex@cortex.ai" />
                  <Field label="Role" defaultValue="Software Engineer" />
                  <Field label="Timezone" defaultValue="GMT+1" />
                </div>
                <div className="mt-4 flex gap-2">
                  <Button>Save changes</Button>
                  <Button variant="outline">Cancel</Button>
                </div>
              </Card>
            </>
          )}

          {tab === "Appearance" && (
            <Card>
              <SectionHeader title="Appearance" desc="Choose how Cortex looks." />
              <div className="grid grid-cols-3 gap-3">
                {["Matte black", "Graphite", "Soft white"].map((t, i) => (
                  <button
                    key={t}
                    className={`rounded-md border p-3 text-left text-sm transition ${
                      i === 0 ? "border-foreground/60 bg-surface-2" : "border-border bg-surface-1 hover:bg-surface-2"
                    }`}
                  >
                    <div
                      className="h-16 rounded-md mb-2"
                      style={{
                        background:
                          i === 0
                            ? "linear-gradient(135deg, #0c0c0e, #1a1a1d)"
                            : i === 1
                            ? "linear-gradient(135deg, #1a1a1d, #2a2a2e)"
                            : "linear-gradient(135deg, #ededed, #f6f6f6)",
                      }}
                    />
                    {t}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {tab === "AI" && (
            <Card>
              <SectionHeader title="AI behavior" desc="Adjust how Cortex assists you." />
              <ToggleRow label="Proactive suggestions" desc="Surface insights without asking." defaultOn />
              <ToggleRow label="Auto-summarize sessions" desc="Recap focus sessions automatically." defaultOn />
              <ToggleRow label="Smart distractions" desc="Detect and pause notifications during deep work." defaultOn />
              <ToggleRow label="Long-term memory" desc="Allow Cortex to learn your patterns over time." />
            </Card>
          )}

          {tab === "Voice" && (
            <Card>
              <SectionHeader title="Voice assistant" desc="Control your voice experience." />
              <ToggleRow label="Wake word" desc='Activate with "Hey Cortex".' defaultOn />
              <ToggleRow label="Voice replies" desc="Hear Cortex's responses aloud." />
              <div className="mt-4">
                <label className="block text-sm mb-2">Voice tone</label>
                <select className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm outline-none">
                  <option>Calm</option>
                  <option>Neutral</option>
                  <option>Energetic</option>
                </select>
              </div>
            </Card>
          )}

          {tab === "Notifications" && (
            <Card>
              <SectionHeader title="Notifications" desc="Choose what reaches you." />
              <ToggleRow label="Focus alerts" desc="Beginning and end of sessions." defaultOn />
              <ToggleRow label="Reminders" desc="Hydration, posture, breaks." defaultOn />
              <ToggleRow label="Weekly insights" desc="A Sunday recap of your week." defaultOn />
            </Card>
          )}

          {tab === "Goals" && (
            <Card>
              <SectionHeader title="Productivity goals" desc="What does a great week look like?" />
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Daily focus target" defaultValue="5h" />
                <Field label="Weekly study target" defaultValue="20h" />
                <Field label="Coding target" defaultValue="25h" />
                <Field label="Break frequency" defaultValue="every 50 min" />
              </div>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-5">
      <div className="text-base font-medium">{title}</div>
      <div className="text-sm text-muted-foreground">{desc}</div>
    </div>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1.5">{label}</span>
      <input
        {...rest}
        className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm outline-none focus:border-foreground/30"
      />
    </label>
  );
}

function ToggleRow({ label, desc, defaultOn = false }: { label: string; desc: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between border-t border-border py-3 first:border-t-0">
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <button
        onClick={() => setOn((v) => !v)}
        className={`relative h-6 w-11 rounded-full border transition ${
          on ? "bg-foreground border-foreground" : "bg-surface-2 border-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full transition ${
            on ? "left-[22px] bg-background" : "left-0.5 bg-foreground/60"
          }`}
        />
      </button>
    </div>
  );
}
