const API_BASE = "/api";

const buildMealRequest = (meal) => {
  if (meal instanceof FormData) {
    return {
      method: "POST",
      body: meal,
    };
  }

  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meal),
  };
};

const readError = async (res, fallback) => {
  const data = await res.json().catch(() => ({}));
  return new Error(data.message || fallback);
};

const serializeMealForOutbox = (meal) => {
  if (!(meal instanceof FormData)) {
    return meal;
  }

  const serializedMeal = {};
  for (const [key, value] of meal.entries()) {
    if (typeof value === "string") {
      serializedMeal[key] = value;
    }
  }

  return serializedMeal;
};

export const SyncService = {
  async getMeals() {
    try {
      const res = await fetch(`${API_BASE}/meals`);
      if (!res.ok) {
        throw new Error("Failed to fetch meals");
      }

      const data = await res.json();
      const meals = Array.isArray(data) ? data : [];
      localStorage.setItem("cached_meals", JSON.stringify(meals));
      return meals;
    } catch (e) {
      const cached = localStorage.getItem("cached_meals");
      return cached ? JSON.parse(cached) : [];
    }
  },

  async register({ name, email, password }) {
    const res = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role: "Buyer" }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || "Unable to create account");
    }

    const data = await res.json();
    return data.user;
  },

  async createSeller({ name, email, password }) {
    const res = await fetch(`${API_BASE}/sellers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    if (!res.ok) {
      throw await readError(res, "Unable to create seller account.");
    }

    const data = await res.json();
    return data.user;
  },

async getSellers() {
  const res = await fetch(`${API_BASE}/sellers`);

  if (!res.ok) {
    throw await readError(res, "Unable to load registered sellers.");
  }

  const data = await res.json();
  return Array.isArray(data.sellers) ? data.sellers : [];
},

async updateSeller(id, seller) {
  const res = await fetch(`${API_BASE}/sellers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(seller),
  });
  if (!res.ok) throw await readError(res, "Unable to update seller account.");
  return (await res.json()).seller;
},

async deleteSeller(id) {
  const res = await fetch(`${API_BASE}/sellers/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res, "Unable to delete seller account.");
  return await res.json();
},


  async login({ email, password, role }) {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || "Invalid email or password");
    }

    const data = await res.json();
    return data.user;
  },

  async getSession() {
    const res = await fetch(`${API_BASE}/session`);
    if (res.status === 401) return null;
    if (!res.ok) throw await readError(res, "Unable to restore session");
    const data = await res.json();
    return data.user;
  },

  async logout() {
    const res = await fetch(`${API_BASE}/logout`, { method: "POST" });
    if (!res.ok) throw await readError(res, "Unable to log out");
  },

  async getInventory(role) {
    if (role === "Seller") {
      // Sellers share one menu. Read the canonical public menu first so an
      // older API that filters inventory by seller cannot hide shared meals.
      try {
        const sharedRes = await fetch(`${API_BASE}/meals`);
        if (sharedRes.ok) {
          const sharedMeals = await sharedRes.json();
          if (Array.isArray(sharedMeals)) return sharedMeals;
        }
      } catch (error) {
        console.warn("Shared meal list is temporarily unavailable:", error);
      }
    }

    try {
      const res = await fetch(`${API_BASE}/inventory`);
      if (!res.ok) {
        throw await readError(res, "Failed to fetch inventory");
      }

      const data = await res.json();
      const inventory = Array.isArray(data) ? data : [];
      return inventory;
    } catch (e) {
      // The buyer menu endpoint is also the canonical shared meal list. It is
      // public by design, so sellers can still see admin and peer meals when
      // the staff inventory request is unavailable or their session expired.
      try {
        const res = await fetch(`${API_BASE}/meals`);
        if (!res.ok) throw await readError(res, "Failed to fetch shared meals");
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch (fallbackError) {
        console.error("Unable to load shared inventory:", e, fallbackError);
        return [];
      }
    }
  },

  async getLowStock(role) {
    try {
      const res = await fetch(`${API_BASE}/inventory/low-stock`);
      if (!res.ok) {
        throw new Error("Failed to fetch low stock items");
      }

      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  },

  async addMeal(meal, role) {
    try {
      const res = await fetch(`${API_BASE}/meals`, buildMealRequest(meal));
      if (!res.ok) {
        throw await readError(res, "Failed to save meal");
      }
      return await res.json().catch(() => ({ success: true }));
    } catch (error) {
      if (error instanceof TypeError) {
        this.addToOutbox("addMeal", { meal: serializeMealForOutbox(meal), role });
      }
      throw error;
    }
  },

  async updateMeal(meal, role) {
    try {
      const res = await fetch(`${API_BASE}/meals`, buildMealRequest(meal));
      if (!res.ok) {
        throw await readError(res, "Failed to update meal");
      }
      return await res.json().catch(() => ({ success: true }));
    } catch (error) {
      if (error instanceof TypeError) {
        this.addToOutbox("updateMeal", { meal: serializeMealForOutbox(meal), role });
      }
      throw error;
    }
  },

  async deleteMeal(id, role) {
    try {
      const res = await fetch(`${API_BASE}/meals/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw await readError(res, "Unable to delete this meal.");
      }
      return await res.json().catch(() => ({ success: true }));
    } catch (error) {
      if (error instanceof TypeError) {
        this.addToOutbox("deleteMeal", { id, role });
      }
      throw error;
    }
  },

  async getSales() {
    try {
      const res = await fetch(`${API_BASE}/sales`);
      return await res.json();
    } catch (e) {
      return [];
    }
  },

  async getMyOrders() {
    const res = await fetch(`${API_BASE}/my-orders`);
    if (!res.ok) throw await readError(res, "Unable to load your orders");
    return await res.json();
  },

  async processSale(sale) {
    try {
      const res = await fetch(`${API_BASE}/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sale),
      });
      if (!res.ok) throw await readError(res, "Unable to record sale");
    } catch (error) {
      if (error instanceof TypeError) this.addToOutbox("processSale", sale);
      else throw error;
    }
  },

  async updateOrderStatus(id, status) {
    const res = await fetch(`${API_BASE}/sales/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) throw await readError(res, "Unable to update order status");
    return await res.json();
  },

  async initializePayment(payload) {
    const res = await fetch(`${API_BASE}/payments/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || "Unable to start checkout");
    }

    return await res.json();
  },

  async verifyPayment(reference) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(`${API_BASE}/payments/verify/${encodeURIComponent(reference)}`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const error = new Error(data.message || `Unable to confirm payment (HTTP ${res.status}).`);
          error.status = res.status;
          throw error;
        }
        return await res.json();
      } catch (error) {
        lastError = error;
        const retryable = !Number.isInteger(error?.status) || [502, 503, 504].includes(error.status);
        if (!retryable || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    throw lastError || new Error("Unable to confirm payment.");
  },

  async getPreOrders() {
    try {
      const res = await fetch(`${API_BASE}/preorders`);
      return await res.json();
    } catch (e) {
      return [];
    }
  },

  async createPreOrder(preorder) {
    try {
      const res = await fetch(`${API_BASE}/preorders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preorder),
      });
      if (!res.ok) throw await readError(res, "Unable to create pre-order");
    } catch (error) {
      if (error instanceof TypeError) this.addToOutbox("createPreOrder", preorder);
      else throw error;
    }
  },

  async updatePreOrderStatus(id, status) {
    try {
      const res = await fetch(`${API_BASE}/preorders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw await readError(res, "Unable to update pre-order");
    } catch (error) {
      if (error instanceof TypeError) this.addToOutbox("updatePreOrderStatus", { id, status });
      else throw error;
    }
  },

  async getFeedback() {
    try {
      const res = await fetch(`${API_BASE}/feedback`);
      return await res.json();
    } catch (e) {
      return [];
    }
  },

  async submitFeedback(feedback) {
    try {
      const res = await fetch(`${API_BASE}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feedback),
      });
      if (!res.ok) throw await readError(res, "Unable to submit feedback");
    } catch (error) {
      if (error instanceof TypeError) this.addToOutbox("submitFeedback", feedback);
      else throw error;
    }
  },

  async getNotifications() {
    try {
      const res = await fetch(`${API_BASE}/notifications`);
      if (!res.ok) throw await readError(res, "Unable to fetch notifications");
      return await res.json();
    } catch (e) {
      return [];
    }
  },

  async markNotificationAsRead(id) {
    try {
      const res = await fetch(`${API_BASE}/notifications/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      if (!res.ok) {
        throw await readError(res, "Unable to mark notification as read");
      }
      return await res.json().catch(() => ({ success: true }));
    } catch (error) {
      if (error instanceof TypeError) this.addToOutbox("markNotificationAsRead", { id });
      throw error;
    }
  },

  async markNotificationsAsRead(id) {
    const res = await fetch(`${API_BASE}/notifications/read`, {
      method: "POST",
      headers: id ? { "Content-Type": "application/json" } : undefined,
      body: id ? JSON.stringify({ id }) : undefined,
    });

    if (!res.ok) {
      throw await readError(res, "Unable to mark notifications as read");
    }
    return await res.json().catch(() => ({ success: true }));
  },


  async getNotificationPreferences() {
    const res = await fetch(`${API_BASE}/notification-preferences`);
    if (!res.ok) throw await readError(res, "Unable to load notification settings");
    return await res.json();
  },

  async saveNotificationPreferences(preferences) {
    const res = await fetch(`${API_BASE}/notification-preferences`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(preferences),
    });
    if (!res.ok) throw await readError(res, "Unable to save notification settings");
  },

  async sendNotification(notif) {
    try {
      const res = await fetch(`${API_BASE}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notif),
      });
      if (!res.ok) throw await readError(res, "Unable to send notification");
    } catch (error) {
      if (error instanceof TypeError) this.addToOutbox("sendNotification", notif);
      else throw error;
    }
  },

  addToOutbox(action, data) {
    const outbox = JSON.parse(localStorage.getItem("sync_outbox") || "[]");
    outbox.push({ action, data, timestamp: new Date().toISOString() });
    localStorage.setItem("sync_outbox", JSON.stringify(outbox));
  },

  async syncOutbox() {
    const outbox = JSON.parse(localStorage.getItem("sync_outbox") || "[]");
    if (outbox.length === 0) return;

    const remaining = [];
    for (const item of outbox) {
      try {
        if (item.action === "addMeal") await this.addMeal(item.data.meal ?? item.data, item.data.role);
        else if (item.action === "updateMeal") await this.updateMeal(item.data.meal ?? item.data, item.data.role);
        else if (item.action === "deleteMeal") await this.deleteMeal(item.data.id, item.data.role);
        else if (item.action === "processSale") await this.processSale(item.data);
        else if (item.action === "createPreOrder") await this.createPreOrder(item.data);
        else if (item.action === "updatePreOrderStatus") await this.updatePreOrderStatus(item.data.id, item.data.status);
        else if (item.action === "submitFeedback") await this.submitFeedback(item.data);
        else if (item.action === "sendNotification") await this.sendNotification(item.data);
        else if (item.action === "markNotificationAsRead") await this.markNotificationAsRead(item.data.id);
      } catch (e) {
        remaining.push(item);
      }
    }
    localStorage.setItem("sync_outbox", JSON.stringify(remaining));
  },

  async uploadImage(file, role) {
    const formData = new FormData();
    formData.append("image", file);
    const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    return data.url || data.imageUrl;
  }
};
