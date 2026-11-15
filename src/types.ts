export const Role = {
  ADMIN: "Admin",
  SELLER: "Seller",
  BUYER: "Buyer"
};

export interface Meal {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  minimum_threshold?: number;
  image_url: string;
  available_start: string;
  available_end: string;
}

export interface Sale {
  id: string;
  meal_id: string;
  quantity: number;
  total_price: number;
  customer_name: string;
  timestamp: string;
}

export interface PreOrder {
  id: string;
  customer_name: string;
  meal_id: string;
  quantity: number;
  pickup_time: string;
  status: "Pending" | "Ready" | "Collected";
  timestamp: string;
}

export interface Feedback {
  id: string;
  customer_name: string;
  meal_id: string;
  rating: number;
  comment: string;
  timestamp: string;
}

export interface NotificationLog {
  id: string;
  message: string;
  recipients_count: number;
  channel: "SMS" | "Email";
  timestamp: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}