import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Button } from "@/components/cortex/ui";
import { useState, useEffect, useCallback } from "react";
import { cortexClient, UserSettingsData } from "@/lib/api";
import { useCortexAuth } from "@/hooks/useCortexAuth";
import { toast } from "sonner";

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

  const { user, isBackendOffline, retrySync, isLoading: isAuthLoading } = useCortexAuth();
  const userId = user?.user_id;

  // Settings State
  const [settings, setSettings] = useState<UserSettingsData>({
    theme: "matte_black",
    proactive_suggestions: true,
    auto_summarize_sessions: true,
    smart_distractions: true,
    long_term_memory: false,
    wake_word: true,
    voice_replies: false,
    voice_tone: "Calm",
    focus_alerts: true,
    reminders_alerts: true,
    weekly_insights: true,
    daily_focus_target: "5h",
    weekly_study_target: "20h",
    coding_target: "25h",
    break_frequency: "every 50 min",
    name: "",
    role: "",
    timezone: "",
  });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchSettings = useCallback(() => {
    if (!userId) {
      if (!isAuthLoading && !isBackendOffline) {
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setLoadError(null);
    cortexClient
      .getUserSettings(userId)
      .then((data) => {
        // Sync profile fields from user session if settings fields are empty
        setSettings({
          ...data,
          name:
            data.name ||
            (user?.first_name ? `${user.first_name} ${user.last_name || ""}`.trim() : ""),
          role: data.role || "Software Engineer",
          timezone: data.timezone || "GMT",
        });
      })
      .catch((err) => {
        console.error("Failed to load settings:", err);
        setLoadError(err.message || "Failed to load settings");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [userId, user, isAuthLoading, isBackendOffline]);

  // Load settings on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSetting = async (field: keyof UserSettingsData, value: any) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    try {
      await cortexClient.updateUserSettings(userId!, { [field]: value });
      toast.success("Settings updated");
      if (field === "theme") {
        window.dispatchEvent(new CustomEvent("cortex:theme-change", { detail: value }));
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to save setting");
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await cortexClient.updateUserSettings(userId!, {
        name: settings.name,
        role: settings.role,
        timezone: settings.timezone,
      });
      toast.success("Profile saved successfully");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save profile");
    }
  };

  if (isBackendOffline || loadError) {
    return (
      <AppLayout>
        <PageHeader title="Settings" description="Configure your CortexAI workspace." />
        <div className="flex h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <div className="text-lg font-medium text-destructive">
            {isBackendOffline ? "Daemon Offline" : "Settings Load Error"}
          </div>
          <div className="max-w-md text-sm text-muted-foreground">
            {isBackendOffline
              ? "The CortexAI Desktop Daemon is currently offline. Please ensure the backend is running and try again."
              : `Unable to retrieve settings from the database: ${loadError}`}
          </div>
          <Button
            onClick={() => {
              if (isBackendOffline) {
                retrySync();
              } else {
                fetchSettings();
              }
            }}
            className="mt-2"
          >
            Retry Connection
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (loading || isAuthLoading) {
    return (
      <AppLayout>
        <PageHeader title="Settings" description="Configure your CortexAI workspace." />
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Loading settings...
        </div>
      </AppLayout>
    );
  }

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
                  tab === t
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:bg-surface-2/60"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </Card>

        <div className="space-y-4">
          {tab === "Account" && (
            <Card>
              <SectionHeader title="Profile" desc="Update your personal details." />
              <form onSubmit={handleProfileSave} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field
                    label="Name"
                    value={settings.name || ""}
                    onChange={(e) => setSettings((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <Field label="Email" value={user?.email || ""} disabled className="opacity-60" />
                  <Field
                    label="Role"
                    value={settings.role || ""}
                    onChange={(e) => setSettings((prev) => ({ ...prev, role: e.target.value }))}
                  />
                  <Field
                    label="Timezone"
                    value={settings.timezone || ""}
                    onChange={(e) => setSettings((prev) => ({ ...prev, timezone: e.target.value }))}
                  />
                </div>
                <div className="mt-4 flex gap-2">
                  <Button type="submit">Save changes</Button>
                </div>
              </form>
            </Card>
          )}

          {tab === "Appearance" && (
            <Card>
              <SectionHeader title="Appearance" desc="Choose how Cortex looks." />
              <div className="grid grid-cols-3 gap-3">
                {[
                  {
                    id: "matte_black",
                    name: "Matte black",
                    gradient: "linear-gradient(135deg, #0c0c0e, #1a1a1d)",
                  },
                  {
                    id: "graphite",
                    name: "Graphite",
                    gradient: "linear-gradient(135deg, #1a1a1d, #2a2a2e)",
                  },
                  {
                    id: "soft_white",
                    name: "Soft white",
                    gradient: "linear-gradient(135deg, #ededed, #f6f6f6)",
                  },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => updateSetting("theme", t.id)}
                    className={`rounded-md border p-3 text-left text-sm transition cursor-pointer ${
                      settings.theme === t.id
                        ? "border-foreground bg-surface-2"
                        : "border-border bg-surface-1 hover:bg-surface-2"
                    }`}
                  >
                    <div className="h-16 rounded-md mb-2" style={{ background: t.gradient }} />
                    {t.name}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {tab === "AI" && (
            <Card>
              <SectionHeader title="AI behavior" desc="Adjust how Cortex assists you." />
              <ToggleRow
                label="Proactive suggestions"
                desc="Surface insights without asking."
                checked={settings.proactive_suggestions}
                onChange={(val) => updateSetting("proactive_suggestions", val)}
              />
              <ToggleRow
                label="Auto-summarize sessions"
                desc="Recap focus sessions automatically."
                checked={settings.auto_summarize_sessions}
                onChange={(val) => updateSetting("auto_summarize_sessions", val)}
              />
              <ToggleRow
                label="Smart distractions"
                desc="Detect and pause notifications during deep work."
                checked={settings.smart_distractions}
                onChange={(val) => updateSetting("smart_distractions", val)}
              />
              <ToggleRow
                label="Long-term memory"
                desc="Allow Cortex to learn your patterns over time."
                checked={settings.long_term_memory}
                onChange={(val) => updateSetting("long_term_memory", val)}
              />
            </Card>
          )}

          {tab === "Voice" && (
            <Card>
              <SectionHeader title="Voice assistant" desc="Control your voice experience." />
              <ToggleRow
                label="Wake word"
                desc='Activate with "Hey Cortex".'
                checked={settings.wake_word}
                onChange={(val) => updateSetting("wake_word", val)}
              />
              <ToggleRow
                label="Voice replies"
                desc="Hear Cortex's responses aloud."
                checked={settings.voice_replies}
                onChange={(val) => updateSetting("voice_replies", val)}
              />
              <div className="mt-4 border-t border-border pt-4">
                <label className="block text-sm mb-2 font-medium">Voice tone</label>
                <select
                  value={settings.voice_tone}
                  onChange={(e) => updateSetting("voice_tone", e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm outline-none focus:border-foreground/30"
                >
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
              <ToggleRow
                label="Focus alerts"
                desc="Beginning and end of sessions."
                checked={settings.focus_alerts}
                onChange={(val) => updateSetting("focus_alerts", val)}
              />
              <ToggleRow
                label="Reminders"
                desc="Hydration, posture, breaks."
                checked={settings.reminders_alerts}
                onChange={(val) => updateSetting("reminders_alerts", val)}
              />
              <ToggleRow
                label="Weekly insights"
                desc="A Sunday recap of your week."
                checked={settings.weekly_insights}
                onChange={(val) => updateSetting("weekly_insights", val)}
              />
            </Card>
          )}

          {tab === "Goals" && (
            <Card>
              <SectionHeader title="Productivity goals" desc="What does a great week look like?" />
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                <Field
                  label="Daily focus target"
                  value={settings.daily_focus_target}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, daily_focus_target: e.target.value }))
                  }
                  onBlur={() => updateSetting("daily_focus_target", settings.daily_focus_target)}
                />
                <Field
                  label="Weekly study target"
                  value={settings.weekly_study_target}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, weekly_study_target: e.target.value }))
                  }
                  onBlur={() => updateSetting("weekly_study_target", settings.weekly_study_target)}
                />
                <Field
                  label="Coding target"
                  value={settings.coding_target}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, coding_target: e.target.value }))
                  }
                  onBlur={() => updateSetting("coding_target", settings.coding_target)}
                />
                <Field
                  label="Break frequency"
                  value={settings.break_frequency}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, break_frequency: e.target.value }))
                  }
                  onBlur={() => updateSetting("break_frequency", settings.break_frequency)}
                />
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

function Field({
  label,
  className = "",
  ...rest
}: { label: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="block text-xs text-muted-foreground mb-1.5">{label}</span>
      <input
        {...rest}
        className={`w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm outline-none focus:border-foreground/30 ${className}`}
      />
    </label>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border py-3 first:border-t-0">
      <div>
        <div className="text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full border transition cursor-pointer ${
          checked ? "bg-foreground border-foreground" : "bg-surface-2 border-border"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full transition ${
            checked ? "left-[22px] bg-background" : "left-0.5 bg-foreground/60"
          }`}
        />
      </button>
    </div>
  );
}
