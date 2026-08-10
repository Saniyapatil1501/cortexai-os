import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/cortex/AppLayout";
import { Card, PageHeader, Button } from "@/components/cortex/ui";
import { Droplets, Activity, BookOpen, Code2, Bell, Plus } from "lucide-react";
import { useState, useEffect } from "react";
import { cortexClient, ReminderItem } from "@/lib/api";
import { useCortexAuth } from "@/hooks/useCortexAuth";

export const Route = createFileRoute("/reminders")({
  head: () => ({
    meta: [
      { title: "Reminders — CortexAI" },
      {
        name: "description",
        content: "Gentle, intelligent reminders that protect your body and your focus.",
      },
    ],
  }),
  component: RemindersPage,
});

function getReminderIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes("hydra") || t.includes("water") || t.includes("drink")) return Droplets;
  if (t.includes("posture") || t.includes("sit") || t.includes("shoulder") || t.includes("back"))
    return Activity;
  if (t.includes("study") || t.includes("reflect") || t.includes("read")) return BookOpen;
  if (t.includes("code") || t.includes("screen") || t.includes("pr") || t.includes("dev"))
    return Code2;
  return Bell;
}

function RemindersPage() {
  const { user } = useCortexAuth();
  const userId = user?.user_id;

  const [reminders, setReminders] = useState<ReminderItem[]>([]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"create" | "configure">("create");
  const [selectedReminder, setSelectedReminder] = useState<ReminderItem | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [interval, setIntervalVal] = useState("");

  useEffect(() => {
    if (!userId) return;
    cortexClient
      .getReminders(userId)
      .then((data) => {
        setReminders(data);
      })
      .catch(console.error);
  }, [userId]);

  const handleToggle = (id: number, currentVal: boolean) => {
    cortexClient
      .updateReminder(id, { is_enabled: !currentVal })
      .then((updated) => {
        setReminders((prev) => prev.map((x) => (x.id === id ? updated : x)));
      })
      .catch(console.error);
  };

  const handleOpenCreateModal = () => {
    setModalType("create");
    setTitle("");
    setDesc("");
    setIntervalVal("");
    setModalOpen(true);
  };

  const handleOpenConfigureModal = (reminder: ReminderItem) => {
    setModalType("configure");
    setSelectedReminder(reminder);
    setIntervalVal(reminder.recurrence_interval);
    setModalOpen(true);
  };

  const handleSaveReminder = async () => {
    if (!userId) return;

    if (modalType === "create") {
      if (!title.trim() || !interval.trim()) return;
      try {
        const newRem = await cortexClient.createReminder(userId, title, desc, interval);
        setReminders((prev) => [...prev, newRem]);
        setModalOpen(false);
      } catch (e) {
        console.error("Error creating reminder:", e);
      }
    } else if (modalType === "configure" && selectedReminder) {
      if (!interval.trim()) return;
      try {
        const updated = await cortexClient.updateReminder(selectedReminder.id, {
          recurrence_interval: interval,
        });
        setReminders((prev) => prev.map((x) => (x.id === selectedReminder.id ? updated : x)));
        setModalOpen(false);
      } catch (e) {
        console.error("Error updating reminder:", e);
      }
    }
  };

  return (
    <AppLayout>
      <PageHeader
        title="Reminders"
        description="Quiet nudges to keep your body and attention aligned."
        actions={
          <Button onClick={handleOpenCreateModal}>
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
                  onClick={() => handleOpenConfigureModal(it)}
                  className="text-foreground/80 hover:text-foreground cursor-pointer"
                >
                  Configure
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Premium custom modal overlay */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 cursor-pointer"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-lg border border-border bg-surface-1/95 p-6 shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold tracking-tight text-foreground mb-4">
              {modalType === "create" ? "New Reminder" : "Configure Recurrence"}
            </h3>

            <div className="space-y-4">
              {modalType === "create" && (
                <>
                  <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1.5">Title</span>
                    <input
                      placeholder="e.g. Stretch or Hydrate"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-foreground/40"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1.5">Description</span>
                    <input
                      placeholder="e.g. Drink a glass of water"
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                      className="w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-foreground/40"
                    />
                  </label>
                </>
              )}

              <label className="block">
                <span className="block text-xs text-muted-foreground mb-1.5">
                  Recurrence Interval
                </span>
                <input
                  placeholder="e.g. every 30m or at 3:30 PM"
                  value={interval}
                  onChange={(e) => setIntervalVal(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface-2 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-foreground/40"
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2 text-sm">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-md border border-border bg-surface-2 px-4 py-2 hover:bg-surface-3 transition cursor-pointer text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveReminder}
                disabled={
                  modalType === "create" ? !title.trim() || !interval.trim() : !interval.trim()
                }
                className="rounded-md bg-foreground text-background font-medium px-4 py-2 hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition cursor-pointer ${
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
