const BASE_URL = "http://127.0.0.1:8000/api";

export interface UserProfile {
  id: number;
  email: string;
}

export interface FocusSession {
  id: number;
  user_id: number;
  intention: string;
  started_at: string;
  ended_at?: string;
  duration_seconds: number;
  distraction_count: number;
  completed: boolean;
}

export interface ActivitySummary {
  total_seconds: number;
  categories: {
    code: number;
    study: number;
    distraction: number;
  };
  score: number;
}

export interface ReminderItem {
  id: number;
  title: string;
  description?: string;
  recurrence_interval: string;
  is_enabled: boolean;
}

export const cortexClient = {
  async login(email: string): Promise<{ user_id: number; email: string }> {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    return res.json();
  },

  async startFocusSession(userId: number, intention: string): Promise<FocusSession> {
    const res = await fetch(`${BASE_URL}/sessions/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, intention }),
    });
    return res.json();
  },

  async endFocusSession(sessionId: number, completed: boolean, distractionCount: number): Promise<FocusSession> {
    const res = await fetch(`${BASE_URL}/sessions/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, completed, distraction_count: distractionCount }),
    });
    return res.json();
  },

  async getActiveFocusSession(userId: number): Promise<FocusSession | null> {
    const res = await fetch(`${BASE_URL}/sessions/active/${userId}`);
    if (res.status === 404) return null;
    return res.json();
  },

  async getActivitySummary(userId: number): Promise<ActivitySummary> {
    const res = await fetch(`${BASE_URL}/activities/summary/${userId}`);
    return res.json();
  },

  async getProductivityAnalytics(userId: number): Promise<{ day: string; focus: number; distraction: number }[]> {
    const res = await fetch(`${BASE_URL}/activities/analytics/productivity/${userId}`);
    return res.json();
  },

  async getHeatmapAnalytics(userId: number): Promise<number[][]> {
    const res = await fetch(`${BASE_URL}/activities/analytics/heatmap/${userId}`);
    return res.json();
  },

  async getAppsAnalytics(userId: number): Promise<{ name: string; time: string; pct: number; type: string }[]> {
    const res = await fetch(`${BASE_URL}/activities/analytics/apps/${userId}`);
    return res.json();
  },

  async getDistractionsAnalytics(userId: number): Promise<{ d: string; v: number }[]> {
    const res = await fetch(`${BASE_URL}/activities/analytics/distractions/${userId}`);
    return res.json();
  },

  async getWeeklyHoursAnalytics(userId: number): Promise<{ d: string; code: number; study: number }[]> {
    const res = await fetch(`${BASE_URL}/activities/analytics/weekly_hours/${userId}`);
    return res.json();
  },

  async getReminders(userId: number): Promise<ReminderItem[]> {
    const res = await fetch(`${BASE_URL}/reminders/${userId}`);
    return res.json();
  },

  async createReminder(userId: number, title: string, description: string, recurrenceInterval: string): Promise<ReminderItem> {
    const res = await fetch(`${BASE_URL}/reminders/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, title, description, recurrence_interval: recurrenceInterval }),
    });
    return res.json();
  },

  async updateReminder(reminderId: number, data: { is_enabled?: boolean; title?: string; recurrence_interval?: string }): Promise<ReminderItem> {
    const res = await fetch(`${BASE_URL}/reminders/${reminderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async chatStream(userId: number, message: string, onChunk: (chunk: string) => void): Promise<void> {
    const response = await fetch(`${BASE_URL}/assistant/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, message }),
    });

    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      onChunk(chunk);
    }
  },

  async getChatHistory(userId: number): Promise<{ role: string; content: string }[]> {
    const res = await fetch(`${BASE_URL}/assistant/history/${userId}`);
    return res.json();
  }
};
