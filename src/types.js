export const Role = {
  ADMIN: "Admin",
  SELLER: "Seller",
  BUYER: "Buyer"
};

// Meal definition
// {
//   id: string,
//   name: string,
//   category: string,
//   price: number,
//   stock: number,
//   image_url: string,
//   available_start: string, // HH:mm
//   available_end: string    // HH:mm
// }

// Sale definition
// {
//   id: string,
//   meal_id: string,
//   quantity: number,
//   total_price: number,
//   customer_name: string,
//   timestamp: string
// }

// PreOrder definition
// {
//   id: string,
//   customer_name: string,
//   meal_id: string,
//   quantity: number,
//   pickup_time: string,
//   status: "Pending" | "Ready" | "Collected",
//   timestamp: string
// }

// Feedback definition
// {
//   id: string,
//   customer_name: string,
//   meal_id: string,
//   rating: number,
//   comment: string,
//   timestamp: string
// }

// NotificationLog definition
// {
//   id: string,
//   message: string,
//   recipients_count: number,
//   channel: "SMS" | "Email",
//   timestamp: string
// }

// User definition
// {
//   id: string,
//   name: string,
//   email: string,
//   role: Role
// }
