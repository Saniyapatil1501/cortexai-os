const BASE_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000/api";

let tokenGetter: (() => Promise<string | null>) | null = null;

async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = { 
    ...options.headers 
  } as Record<string, string>;
  
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  
  if (tokenGetter) {
    try {
      const token = await tokenGetter();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    } catch (e) {
      console.error("Failed to retrieve auth token", e);
    }
  }
  
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`HTTP Error ${res.status}: ${errorText || res.statusText}`);
  }
  return res;
}

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
  target_duration_seconds?: number;
  distraction_count: number;
  completed: boolean;
  app_swaps?: number;
  idle_count?: number;
}

export interface ActivitySummary {
  total_seconds: number;
  categories: {
    code: number;
    study: number;
    distraction: number;
  };
  score: number;
  today?: {
    focus_seconds: number;
    distraction_seconds: number;
    distraction_count: number;
    sessions_count: number;
  };
}

export interface ReminderItem {
  id: number;
  title: string;
  description?: string;
  recurrence_interval: string;
  is_enabled: boolean;
}

export interface UserSettingsData {
  theme: string;
  proactive_suggestions: boolean;
  auto_summarize_sessions: boolean;
  smart_distractions: boolean;
  long_term_memory: boolean;
  wake_word: boolean;
  voice_replies: boolean;
  voice_tone: string;
  focus_alerts: boolean;
  reminders_alerts: boolean;
  weekly_insights: boolean;
  daily_focus_target: string;
  weekly_study_target: string;
  coding_target: string;
  break_frequency: string;
  name?: string;
  role?: string;
  timezone?: string;
}

export interface DocumentItem {
  id: number;
  user_id: number;
  filename: string;
  original_filename: string;
  file_type: string;
  file_path: string;
  file_size: number;
  status: string;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentChunkItem {
  id: number;
  document_id: number;
  user_id: number;
  chunk_index: number;
  content: string;
  token_count: number;
  created_at: string;
}

export interface SearchResultItem {
  document_id: number;
  filename: string;
  chunk_index: number;
  content: string;
  similarity_score: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
  context: string;
}

export const cortexClient = {
  setTokenGetter(getter: () => Promise<string | null>) {
    tokenGetter = getter;
  },

  async syncUser(data: {
    clerk_id: string;
    email: string;
    first_name?: string;
    last_name?: string;
    profile_image_url?: string;
    timezone?: string;
  }): Promise<{
    status: string;
    user_id: number;
    email: string;
    clerk_id: string;
    first_name?: string;
    last_name?: string;
    profile_image_url?: string;
    timezone?: string;
  }> {
    const res = await authedFetch(`${BASE_URL}/auth/sync`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getUserSettings(userId: number): Promise<UserSettingsData> {
    const res = await authedFetch(`${BASE_URL}/auth/settings/${userId}`);
    return res.json();
  },

  async updateUserSettings(userId: number, data: Partial<UserSettingsData>): Promise<UserSettingsData> {
    const res = await authedFetch(`${BASE_URL}/auth/settings/${userId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async startFocusSession(userId: number, intention: string, targetDurationSeconds?: number): Promise<FocusSession> {
    const res = await authedFetch(`${BASE_URL}/sessions/start`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, intention, target_duration_seconds: targetDurationSeconds }),
    });
    return res.json();
  },

  async endFocusSession(sessionId: number, completed: boolean, distractionCount: number): Promise<FocusSession> {
    const res = await authedFetch(`${BASE_URL}/sessions/end`, {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, completed, distraction_count: distractionCount }),
    });
    return res.json();
  },

  async getActiveFocusSession(userId: number): Promise<FocusSession | null> {
    const res = await authedFetch(`${BASE_URL}/sessions/active/${userId}`);
    if (res.status === 404) return null;
    try {
      const data = await res.json();
      return data;
    } catch {
      return null;
    }
  },

  async getActivitySummary(userId: number): Promise<ActivitySummary> {
    const res = await authedFetch(`${BASE_URL}/activities/summary/${userId}`);
    return res.json();
  },

  async getProductivityAnalytics(userId: number): Promise<{ day: string; focus: number; distraction: number }[]> {
    const res = await authedFetch(`${BASE_URL}/activities/analytics/productivity/${userId}`);
    return res.json();
  },

  async getHeatmapAnalytics(userId: number): Promise<number[][]> {
    const res = await authedFetch(`${BASE_URL}/activities/analytics/heatmap/${userId}`);
    return res.json();
  },

  async getAppsAnalytics(userId: number): Promise<{ name: string; time: string; pct: number; type: string }[]> {
    const res = await authedFetch(`${BASE_URL}/activities/analytics/apps/${userId}`);
    return res.json();
  },

  async getDistractionsAnalytics(userId: number): Promise<{ d: string; v: number }[]> {
    const res = await authedFetch(`${BASE_URL}/activities/analytics/distractions/${userId}`);
    return res.json();
  },

  async getWeeklyHoursAnalytics(userId: number): Promise<{ d: string; code: number; study: number }[]> {
    const res = await authedFetch(`${BASE_URL}/activities/analytics/weekly_hours/${userId}`);
    return res.json();
  },

  async getReminders(userId: number): Promise<ReminderItem[]> {
    const res = await authedFetch(`${BASE_URL}/reminders/${userId}`);
    return res.json();
  },

  async createReminder(userId: number, title: string, description: string, recurrenceInterval: string): Promise<ReminderItem> {
    const res = await authedFetch(`${BASE_URL}/reminders/`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, title, description, recurrence_interval: recurrenceInterval }),
    });
    return res.json();
  },

  async updateReminder(reminderId: number, data: { is_enabled?: boolean; title?: string; recurrence_interval?: string }): Promise<ReminderItem> {
    const res = await authedFetch(`${BASE_URL}/reminders/${reminderId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async chatStream(userId: number, message: string, onChunk: (chunk: string) => void): Promise<void> {
    const response = await authedFetch(`${BASE_URL}/assistant/chat`, {
      method: "POST",
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
    const res = await authedFetch(`${BASE_URL}/assistant/history/${userId}`);
    return res.json();
  },

  async clearChatHistory(userId: number): Promise<{ status: string }> {
    const res = await authedFetch(`${BASE_URL}/assistant/history/${userId}`, {
      method: "DELETE",
    });
    return res.json();
  },

  async getDocuments(userId: number): Promise<DocumentItem[]> {
    const res = await authedFetch(`${BASE_URL}/documents/${userId}`);
    return res.json();
  },

  async uploadDocument(userId: number, file: File): Promise<DocumentItem> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("user_id", String(userId));
    const res = await authedFetch(`${BASE_URL}/documents/upload`, {
      method: "POST",
      body: formData,
    });
    return res.json();
  },

  async deleteDocument(documentId: number): Promise<{ status: string }> {
    const res = await authedFetch(`${BASE_URL}/documents/${documentId}`, {
      method: "DELETE",
    });
    return res.json();
  },

  async getDocumentChunks(documentId: number): Promise<DocumentChunkItem[]> {
    const res = await authedFetch(`${BASE_URL}/documents/${documentId}/chunks`);
    return res.json();
  },
  
  async getDocumentStatus(documentId: number): Promise<{ id: number; status: string; chunk_count: number }> {
    const res = await authedFetch(`${BASE_URL}/documents/${documentId}/status`);
    return res.json();
  },

  async semanticSearch(userId: number, query: string, documentId?: number, topK: number = 5): Promise<SearchResponse> {
    const res = await authedFetch(`${BASE_URL}/rag/search`, {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        query,
        document_id: documentId || null,
        top_k: topK
      })
    });
    return res.json();
  },

  async reindex(): Promise<{ status: string; message: string }> {
    const res = await authedFetch(`${BASE_URL}/documents/reindex`, {
      method: "POST"
    });
    return res.json();
  }
};

