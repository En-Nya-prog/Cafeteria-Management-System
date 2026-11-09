const API_BASE = "/api";

const buildHeaders = (role, extraHeaders = {}) => {
  if (!role) {
    return extraHeaders;
  }

  return {
    ...extraHeaders,
    "x-user-role": role,
  };
};

const buildMealRequest = (meal, role) => {
  if (meal instanceof FormData) {
    return {
      method: "POST",
      headers: buildHeaders(role),
      body: meal,
    };
  }

  return {
    method: "POST",
    headers: buildHeaders(role, { "Content-Type": "application/json" }),
    body: JSON.stringify(meal),
  };
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

  async register({ name, email, password, role }) {
    const res = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || "Unable to create account");
    }

    const data = await res.json();
    return data.user;
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

  async getInventory(role) {
    try {
      const res = await fetch(`${API_BASE}/inventory`, {
        headers: buildHeaders(role),
      });
      if (!res.ok) {
        throw new Error("Failed to fetch inventory");
      }

      const data = await res.json();
      console.log("Inventory Data:", data);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  },

  async getLowStock(role) {
    try {
      const res = await fetch(`${API_BASE}/inventory/low-stock`, {
        headers: buildHeaders(role),
      });
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
      const res = await fetch(`${API_BASE}/meals`, buildMealRequest(meal, role));
      if (!res.ok) {
        throw new Error("Failed to save meal");
      }
      return await res.json().catch(() => ({ success: true }));
    } catch (e) {
      this.addToOutbox("addMeal", { meal: serializeMealForOutbox(meal), role });
      throw e;
    }
  },

  async updateMeal(meal, role) {
    try {
      const res = await fetch(`${API_BASE}/meals`, buildMealRequest(meal, role));
      if (!res.ok) {
        throw new Error("Failed to update meal");
      }
      return await res.json().catch(() => ({ success: true }));
    } catch (e) {
      this.addToOutbox("updateMeal", { meal: serializeMealForOutbox(meal), role });
      throw e;
    }
  },

  async deleteMeal(id, role) {
    try {
      const res = await fetch(`${API_BASE}/meals/${id}`, {
        method: "DELETE",
        headers: buildHeaders(role),
      });
      if (!res.ok) {
        throw new Error("Failed to delete meal");
      }
      return await res.json().catch(() => ({ success: true }));
    } catch (e) {
      this.addToOutbox("deleteMeal", { id, role });
      throw e;
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

  async processSale(sale) {
    try {
      await fetch(`${API_BASE}/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sale),
      });
    } catch (e) {
      this.addToOutbox("processSale", sale);
    }
  },

  async processPayment(payload) {
    const res = await fetch(`${API_BASE}/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || "Payment failed");
    }

    return await res.json();
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
      await fetch(`${API_BASE}/preorders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preorder),
      });
    } catch (e) {
      this.addToOutbox("createPreOrder", preorder);
    }
  },

  async updatePreOrderStatus(id, status) {
    try {
      await fetch(`${API_BASE}/preorders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch (e) {
      this.addToOutbox("updatePreOrderStatus", { id, status });
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
      await fetch(`${API_BASE}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feedback),
      });
    } catch (e) {
      this.addToOutbox("submitFeedback", feedback);
    }
  },

  async getNotifications() {
    try {
      const res = await fetch(`${API_BASE}/notifications`);
      return await res.json();
    } catch (e) {
      return [];
    }
  },

  async sendNotification(notif) {
    try {
      await fetch(`${API_BASE}/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(notif),
      });
    } catch (e) {
      this.addToOutbox("sendNotification", notif);
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
      headers: buildHeaders(role),
      body: formData,
    });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    return data.url || data.imageUrl;
  }
};
