import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Button } from "@/components/cortex/ui";
import { Droplets, Activity, BookOpen, Code2, Bell, Plus } from "lucide-react";
import { useState, useEffect } from "react";
import { cortexClient, ReminderItem } from "@/lib/api";

export const Route = createFileRoute("/reminders")({
  head: () => ({
    meta: [
      { title: "Reminders — CortexAI" },
      { name: "description", content: "Gentle, intelligent reminders that protect your body and your focus." },
    ],
  }),
  component: RemindersPage,
});

function getReminderIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes("hydra") || t.includes("water") || t.includes("drink")) return Droplets;
  if (t.includes("posture") || t.includes("sit") || t.includes("shoulder") || t.includes("back")) return Activity;
  if (t.includes("study") || t.includes("reflect") || t.includes("read")) return BookOpen;
  if (t.includes("code") || t.includes("screen") || t.includes("pr") || t.includes("dev")) return Code2;
  return Bell;
}

function RemindersPage() {
  const [reminders, setReminders] = useState<ReminderItem[]>([]);

  useEffect(() => {
    cortexClient.getReminders(1).then((data) => {
      setReminders(data);
    }).catch(console.error);
  }, []);

  const handleToggle = (id: number, currentVal: boolean) => {
    cortexClient.updateReminder(id, { is_enabled: !currentVal }).then((updated) => {
      setReminders((prev) => prev.map((x) => (x.id === id ? updated : x)));
    }).catch(console.error);
  };

  const handleNewReminder = async () => {
    const title = window.prompt("Enter reminder title (e.g. Stretch):");
    if (!title) return;
    const desc = window.prompt("Enter description (e.g. Realign your back):") || "";
    const interval = window.prompt("Enter recurrence (e.g. every 30m, at 3:30 PM):");
    if (!interval) return;

    try {
      const newRem = await cortexClient.createReminder(1, title, desc, interval);
      setReminders((prev) => [...prev, newRem]);
    } catch (e) {
      console.error("Error creating reminder:", e);
    }
  };

  return (
    <AppLayout>
      <PageHeader
        title="Reminders"
        description="Quiet nudges to keep your body and attention aligned."
        actions={
          <Button onClick={handleNewReminder}>
            <Plus className="h-4 w-4" /> New reminder
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {reminders.map((it) => {
          const IconComponent = getReminderIcon(it.title);
          return (
            <Card key={it.id}>
              <div className="flex items-start justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-md border border-border bg-surface-2">
                  <IconComponent className="h-4 w-4" />
                </div>
                <Toggle
                  checked={it.is_enabled}
                  onChange={() => handleToggle(it.id, it.is_enabled)}
                />
              </div>
              <div className="mt-4">
                <div className="text-base font-medium">{it.title}</div>
                <div className="text-sm text-muted-foreground mt-0.5">{it.description}</div>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{it.recurrence_interval}</span>
                <button 
                  onClick={() => {
                    const newInterval = window.prompt("Enter new recurrence interval (e.g. every 45m):", it.recurrence_interval);
                    if (newInterval) {
                      cortexClient.updateReminder(it.id, { recurrence_interval: newInterval }).then((updated) => {
                        setReminders((prev) => prev.map((x) => (x.id === it.id ? updated : x)));
                      }).catch(console.error);
                    }
                  }}
                  className="text-foreground/80 hover:text-foreground"
                >
                  Configure
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </AppLayout>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition ${
        checked ? "bg-foreground border-foreground" : "bg-surface-2 border-border"
      }`}
      aria-pressed={checked}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full transition ${
          checked ? "left-[22px] bg-background" : "left-0.5 bg-foreground/60"
        }`}
      />
    </button>
  );
}
