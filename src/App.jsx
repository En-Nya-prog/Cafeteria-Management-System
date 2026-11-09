import React, { useState, useEffect, useMemo } from 'react';
import { 
  Utensils, 
  ShoppingCart, 
  LayoutDashboard, 
  Package, 
  Bell, 
  Star, 
  LogOut, 
  Plus, 
  Trash2, 
  CheckCircle, 
  Clock, 
  TrendingUp,
  MessageSquare,
  User,
  Search,
  ChevronRight,
  ChevronLeft,
  Menu,
  X,
  Upload,
  CreditCard,
  Smartphone,
  DollarSign,
  Users,
  Calendar,
  Filter,
  MoreVertical,
  Edit3,
  Eye,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  Coffee,
  Sun,
  Moon,
  Settings,
  HelpCircle,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Role } from './types.js';
import { SyncService } from './services/SyncService.js';
import './App.css';

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', size = 'md', className = '', disabled = false, type = 'button', icon: Icon }) => {
  const sizeClasses = {
    xs: 'btn-xs',
    sm: 'btn-sm',
    md: 'btn-md',
    lg: 'btn-lg',
    xl: 'btn-xl'
  };
  
  return (
    <button 
      type={type} 
      onClick={onClick} 
      className={`btn btn-${variant} ${sizeClasses[size]} ${className}`} 
      disabled={disabled}
    >
      {Icon && <Icon size={size === 'xs' ? 14 : size === 'sm' ? 16 : 18} />}
      {children}
    </button>
  );
};

const Card = ({ children, className = "", hover = false, padding = true }) => (
  <div className={`card ${hover ? 'card-hover' : ''} ${padding ? 'card-padding' : ''} ${className}`}>
    {children}
  </div>
);

const Badge = ({ children, variant = "default", size = "sm", dot = false }) => {
  return (
    <span className={`badge badge-${variant} badge-${size}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  );
};

const Avatar = ({ name, src, size = "md", status }) => {
  const initials = name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';
  const sizeClasses = { sm: 'avatar-sm', md: 'avatar-md', lg: 'avatar-lg', xl: 'avatar-xl' };
  
  return (
    <div className={`avatar ${sizeClasses[size]}`}>
      {src ? (
        <img src={src} alt={name} className="avatar-image" />
      ) : (
        <span className="avatar-initials">{initials}</span>
      )}
      {status && <span className={`avatar-status avatar-status-${status}`} />}
    </div>
  );
};

const Input = ({ label, icon: Icon, error, className = "", ...props }) => (
  <div className={`input-group ${className}`}>
    {label && <label className="input-label">{label}</label>}
    <div className="input-wrapper">
      {Icon && <Icon className="input-icon" size={18} />}
      <input className={`input ${Icon ? 'input-with-icon' : ''} ${error ? 'input-error' : ''}`} {...props} />
    </div>
    {error && <span className="input-error-text">{error}</span>}
  </div>
);

const Select = ({ label, options, className = "", ...props }) => (
  <div className={`input-group ${className}`}>
    {label && <label className="input-label">{label}</label>}
    <select className="select" {...props}>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  </div>
);

const Textarea = ({ label, className = "", ...props }) => (
  <div className={`input-group ${className}`}>
    {label && <label className="input-label">{label}</label>}
    <textarea className="textarea" {...props} />
  </div>
);

const IconButton = ({ icon: Icon, onClick, variant = "ghost", size = "md", className = "", badge, ...props }) => (
  <button className={`icon-btn icon-btn-${variant} icon-btn-${size} ${className}`} onClick={onClick} {...props}>
    <Icon size={size === 'sm' ? 16 : size === 'lg' ? 24 : 20} />
    {badge && <span className="icon-btn-badge">{badge}</span>}
  </button>
);

const Skeleton = ({ variant = "text", width, height }) => (
  <div className={`skeleton skeleton-${variant}`} style={{ width, height }} />
);

const EmptyState = ({ icon: Icon, title, description, action }) => (
  <div className="empty-state">
    <div className="empty-state-icon">
      <Icon size={48} />
    </div>
    <h3 className="empty-state-title">{title}</h3>
    <p className="empty-state-description">{description}</p>
    {action}
  </div>
);

const StatCard = ({ title, value, change, changeType, icon: Icon, variant = "default" }) => (
  <Card className={`stat-card stat-card-${variant}`} hover>
    <div className="stat-card-header">
      <span className="stat-card-title">{title}</span>
      <div className={`stat-card-icon stat-card-icon-${variant}`}>
        <Icon size={20} />
      </div>
    </div>
    <div className="stat-card-value">{value}</div>
    {change && (
      <div className={`stat-card-change stat-card-change-${changeType}`}>
        {changeType === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        <span>{change}</span>
        <span className="stat-card-change-label">vs last period</span>
      </div>
    )}
  </Card>
);

const TabButton = ({ active, children, onClick, count }) => (
  <button className={`tab-btn ${active ? 'tab-btn-active' : ''}`} onClick={onClick}>
    {children}
    {count !== undefined && <span className="tab-btn-count">{count}</span>}
  </button>
);

const Divider = ({ label }) => (
  <div className="divider">
    {label && <span className="divider-label">{label}</span>}
  </div>
);

// --- Data ---

const CATEGORY_TIMES = {
  "Breakfast Meals": { start: "06:00", end: "10:30" },
  "Lunch Meals": { start: "11:30", end: "15:00" },
  "Snacks": { start: "15:00", end: "20:00" },
  "Beverages": { start: "06:00", end: "20:00" },
  "Desserts": { start: "11:30", end: "20:00" },
};

const CATEGORY_ICONS = {
  "Breakfast Meals": Sun,
  "Lunch Meals": Utensils,
  "Snacks": Coffee,
  "Beverages": Coffee,
  "Desserts": Sparkles,
};

const makeMeal = (id, name, category, price, stock, description, imageUrl) => ({
  id,
  name,
  category,
  price,
  stock,
  description,
  image_url: imageUrl,
  available_start: CATEGORY_TIMES[category]?.start || "06:00",
  available_end: CATEGORY_TIMES[category]?.end || "20:00",
});

export const DEFAULT_MEALS = [
  makeMeal("b1", "Jollof Rice", "Breakfast Meals", 20, 50, "Spiced tomato rice with fried plantain", "https://images.unsplash.com/photo-1604329760661-e71dc83f8f26?w=400"),
  makeMeal("b2", "Waakye", "Breakfast Meals", 25, 40, "Rice and beans with shito and wele", "https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400"),
  makeMeal("b3", "Hausa Koko", "Breakfast Meals", 10, 60, "Spicy millet porridge with koose", "https://images.unsplash.com/photo-1517673132405-a56a62b18caf?w=400"),
  makeMeal("b4", "Pancakes", "Breakfast Meals", 15, 30, "Fluffy pancakes with syrup and fruit", "https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400"),
  makeMeal("b5", "Omelette", "Breakfast Meals", 12, 45, "Three-egg omelette with veggies", "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=400"),
  makeMeal("l1", "Fried Rice", "Lunch Meals", 22, 55, "Egg fried rice with mixed vegetables", "https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=400"),
  makeMeal("l2", "Banku and Tilapia", "Lunch Meals", 30, 35, "Fermented corn dough with grilled tilapia", "https://images.unsplash.com/photo-1544025162-d76694265947?w=400"),
  makeMeal("l3", "Fufu and Soup", "Lunch Meals", 28, 48, "Pounded cassava with light soup and meat", "https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400"),
  makeMeal("l4", "Chicken Salad Sandwich", "Lunch Meals", 18, 40, "Creamy chicken salad on toasted bread", "https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=400"),
  makeMeal("l5", "Vegetable Stir-fry", "Lunch Meals", 19, 50, "Assorted vegetables stir-fried with tofu", "https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400"),
  makeMeal("s1", "Plantain Chips", "Snacks", 8, 70, "Crispy fried plantain chips", "https://images.unsplash.com/photo-1621447504864-d8686e12698c?w=400"),
  makeMeal("s2", "Samosa", "Snacks", 10, 65, "Fried pastry with spiced potato filling", "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400"),
  makeMeal("s3", "Spring Rolls", "Snacks", 12, 55, "Crispy fried rolls with vegetable filling", "https://images.unsplash.com/photo-1544025162-d76694265947?w=400"),
  makeMeal("s4", "Yogurt Parfait", "Snacks", 15, 40, "Yogurt with granola and fresh berries", "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400"),
  makeMeal("s5", "Fruit Salad", "Snacks", 14, 50, "A mix of seasonal fresh fruits", "https://images.unsplash.com/photo-1564093497595-593b96d80180?w=400"),
  makeMeal("bev1", "Fresh Orange Juice", "Beverages", 10, 80, "100% freshly squeezed orange juice", "https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=400"),
  makeMeal("bev2", "Iced Coffee", "Beverages", 12, 75, "Chilled coffee with milk and sweetener", "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400"),
  makeMeal("bev3", "Herbal Tea", "Beverages", 8, 90, "A soothing blend of herbal teas", "https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400"),
  makeMeal("bev4", "Smoothie", "Beverages", 16, 60, "Blended fruits with yogurt or milk", "https://images.unsplash.com/photo-1505252585461-04db1eb84625?w=400"),
  makeMeal("bev5", "Sparkling Water", "Beverages", 7, 100, "Refreshing carbonated water", "https://images.unsplash.com/photo-1523677011781-c91d1bbe2f9e?w=400"),
  makeMeal("d1", "Chocolate Cake", "Desserts", 20, 30, "Rich and moist chocolate cake slice", "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400"),
  makeMeal("d2", "Cheesecake", "Desserts", 22, 25, "Creamy New York style cheesecake", "https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=400"),
  makeMeal("d3", "Ice Cream", "Desserts", 10, 50, "Scoops of assorted ice cream flavors", "https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=400"),
  makeMeal("d4", "Apple Pie", "Desserts", 18, 35, "Warm apple pie with cinnamon", "https://images.unsplash.com/photo-1568571780765-9276ac8b75a2?w=400"),
  makeMeal("d5", "Fruit Tart", "Desserts", 19, 40, "Pastry tart filled with fresh fruits", "https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=400"),
];

const DEFAULT_LOW_STOCK_THRESHOLD = 10;

const getMealStock = (meal) => Number(meal?.stock ?? meal?.quantity ?? 0);
const getMealPrice = (meal) => Number(meal?.price ?? 0);
const getLowStockThreshold = (meal) => {
  const threshold = Number(meal?.lowStockThreshold ?? meal?.minimum_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
  return Number.isFinite(threshold) ? threshold : DEFAULT_LOW_STOCK_THRESHOLD;
};
const isValidMoMoNumber = (phone) => /^\d{10,15}$/.test(String(phone || "").replace(/\D/g, ""));

// --- Alert Components ---

const LowStockAlert = ({ user, meals }) => {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (user?.role !== Role.ADMIN && user?.role !== Role.SELLER) {
      setItems([]);
      return;
    }

    const fallbackItems = Array.isArray(meals)
      ? meals.filter((meal) => getMealStock(meal) <= getLowStockThreshold(meal))
      : [];

    setItems(fallbackItems);
  }, [meals, user?.role]);

  if (!items.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="alert alert-warning"
    >
      <div className="alert-icon">
        <Bell size={20} />
      </div>
      <div className="alert-content">
        <h4 className="alert-title">Low Stock Alert</h4>
        <p className="alert-description">
          {items.length} item{items.length > 1 ? 's' : ''} running low on stock
        </p>
        <div className="alert-items">
          {items.slice(0, 3).map((item) => (
            <Badge key={item.id} variant="warning" size="sm">
              {item.name}: {getMealStock(item)} left
            </Badge>
          ))}
          {items.length > 3 && <Badge variant="default" size="sm">+{items.length - 3} more</Badge>}
        </div>
      </div>
      <Button variant="ghost" size="sm">View All</Button>
    </motion.div>
  );
};

// --- Main Views ---

const BrowseView = ({ meals, cart, addToCart, handlePreOrder, isMealAvailable, getRemainingTime }) => {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [viewMode, setViewMode] = useState("grid");
  
  const filteredMeals = meals.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchesCat = selectedCategory === "All" || m.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const categories = ["All", "Breakfast Meals", "Lunch Meals", "Snacks", "Beverages", "Desserts"];

  return (
    <div className="browse-view">
      {/* Header */}
      <div className="browse-header">
        <div className="browse-header-content">
          <div>
            <h1 className="page-title">Discover Delicious Meals</h1>
            <p className="page-subtitle">Fresh, tasty, and ready to order</p>
          </div>
          <div className="browse-header-stats">
            <div className="browse-stat">
              <span className="browse-stat-value">{meals.length}</span>
              <span className="browse-stat-label">Total Items</span>
            </div>
            <div className="browse-stat">
              <span className="browse-stat-value">{meals.filter(m => isMealAvailable(m)).length}</span>
              <span className="browse-stat-label">Available Now</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="browse-toolbar">
        <div className="search-container">
          <Search className="search-icon" size={20} />
          <input 
            type="text" 
            placeholder="Search for meals..." 
            className="search-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch("")}>
              <X size={16} />
            </button>
          )}
        </div>
        
        <div className="filter-bar">
          <div className="category-pills">
            {categories.map(cat => (
              <button 
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`category-pill ${selectedCategory === cat ? 'category-pill-active' : ''}`}
              >
                {cat !== "All" && CATEGORY_ICONS[cat] && (
                  <span className="category-pill-icon">
                    {React.createElement(CATEGORY_ICONS[cat], { size: 14 })}
                  </span>
                )}
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Meal Grid */}
      <div className="meal-grid">
        <AnimatePresence mode="popLayout">
          {filteredMeals.map((meal, index) => {
            const available = isMealAvailable(meal);
            const countdown = getRemainingTime(meal);
            const isInCart = cart.some(item => item.meal.id === meal.id);
            const cartItem = cart.find(item => item.meal.id === meal.id);
            
            return (
              <motion.div
                key={meal.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.2, delay: index * 0.02 }}
              >
                <Card 
                  className={`meal-card ${isInCart ? 'meal-card-selected' : ''} ${!available ? 'meal-card-unavailable' : ''}`}
                  hover
                  padding={false}
                >
                  <div className="meal-card-image-wrapper" onClick={() => available && addToCart(meal)}>
                    <img 
                      src={meal.image_url || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} 
                      alt={meal.name} 
                      className="meal-card-image"
                    />
                    
                    <div className="meal-card-overlay">
                      {isInCart && (
                        <div className="meal-card-cart-badge">
                          <CheckCircle size={16} />
                          <span>{cartItem?.quantity || 1}</span>
                        </div>
                      )}
                      
                      <Badge variant="light" size="xs" className="meal-card-category">
                        {meal.category}
                      </Badge>
                      
                      {available && (
                        <div className="meal-card-countdown">
                          <Clock size={12} />
                          <span>{countdown}</span>
                        </div>
                      )}
                      
                      {!available && (
                        <div className="meal-card-unavailable-overlay">
                          <Badge variant="dark" size="md">Not Available</Badge>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="meal-card-content">
                    <div className="meal-card-header">
                      <h3 className="meal-card-title">{meal.name}</h3>
                      <IconButton icon={MoreVertical} size="sm" variant="ghost" />
                    </div>
                    
                    <p className="meal-card-description">{meal.description}</p>
                    
                    <div className="meal-card-footer">
                      <div className="meal-card-price">
                        <span className="meal-card-currency">₵</span>
                        <span className="meal-card-amount">{meal.price.toFixed(2)}</span>
                      </div>
                      
                      {available ? (
                        <Button 
                          onClick={() => addToCart(meal)} 
                          size="sm"
                          icon={Plus}
                          disabled={meal.stock <= 0}
                        >
                          Add
                        </Button>
                      ) : (
                        <Button 
                          onClick={() => handlePreOrder(meal)} 
                          variant="outline" 
                          size="sm"
                          icon={Clock}
                        >
                          Pre-order
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      
      {filteredMeals.length === 0 && (
        <EmptyState 
          icon={Search}
          title="No meals found"
          description="Try adjusting your search or filter to find what you're looking for"
          action={<Button variant="outline" onClick={() => { setSearch(""); setSelectedCategory("All"); }}>Clear Filters</Button>}
        />
      )}
    </div>
  );
};

const ReportsView = ({ sales, meals, preorders, user, fetchData }) => {
  const [period, setPeriod] = useState('daily');

  const filteredSales = useMemo(() => {
    const now = new Date();
    return sales.filter(sale => {
      const saleDate = new Date(sale.timestamp);
      if (period === 'daily') return saleDate.toDateString() === now.toDateString();
      if (period === 'weekly') {
        const weekAgo = new Date();
        weekAgo.setDate(now.getDate() - 7);
        return saleDate >= weekAgo;
      }
      const monthAgo = new Date();
      monthAgo.setMonth(now.getMonth() - 1);
      return saleDate >= monthAgo;
    });
  }, [sales, period]);

  const totalRevenue = filteredSales.reduce((acc, s) => acc + s.total_price, 0);
  const totalItems = filteredSales.reduce((acc, s) => acc + s.quantity, 0);
  const avgOrderValue = filteredSales.length > 0 ? totalRevenue / filteredSales.length : 0;

  return (
    <div className="reports-view">
      <div className="reports-header">
        <div>
          <h1 className="page-title">Sales Analytics</h1>
          <p className="page-subtitle">Track your business performance</p>
        </div>
        <div className="reports-actions">
          <div className="period-tabs">
            {['daily', 'weekly', 'monthly'].map(p => (
              <TabButton key={p} active={period === p} onClick={() => setPeriod(p)}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </TabButton>
            ))}
          </div>
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchData}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard 
          title="Total Revenue" 
          value={`₵${totalRevenue.toFixed(2)}`}
          change="+12.5%"
          changeType="up"
          icon={DollarSign}
          variant="primary"
        />
        <StatCard 
          title="Orders" 
          value={filteredSales.length}
          change="+8.2%"
          changeType="up"
          icon={ShoppingCart}
          variant="blue"
        />
        <StatCard 
          title="Items Sold" 
          value={totalItems}
          change="+5.1%"
          changeType="up"
          icon={Package}
          variant="purple"
        />
        <StatCard 
          title="Avg. Order Value" 
          value={`₵${avgOrderValue.toFixed(2)}`}
          change="-2.3%"
          changeType="down"
          icon={TrendingUp}
          variant="orange"
        />
      </div>

      <Card className="table-card">
        <div className="table-header">
          <h3 className="table-title">Recent Transactions</h3>
          <div className="table-actions">
            <Input placeholder="Search transactions..." icon={Search} className="table-search" />
            <Button variant="outline" size="sm" icon={Filter}>Filter</Button>
          </div>
        </div>
        
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Meal</th>
                <th>Customer</th>
                <th>Qty</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map(sale => (
                <tr key={sale.id}>
                  <td>
                    <div className="table-cell-datetime">
                      <span className="table-cell-date">{new Date(sale.timestamp).toLocaleDateString()}</span>
                      <span className="table-cell-time">{new Date(sale.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </td>
                  <td>
                    <div className="table-cell-meal">
                      <span className="table-cell-meal-name">{meals.find(m => m.id === sale.meal_id)?.name || 'Unknown'}</span>
                    </div>
                  </td>
                  <td>
                    <div className="table-cell-customer">
                      <Avatar name={sale.customer_name} size="sm" />
                      <span>{sale.customer_name}</span>
                    </div>
                  </td>
                  <td><Badge variant="default" size="sm">{sale.quantity}</Badge></td>
                  <td className="table-cell-amount">₵{sale.total_price.toFixed(2)}</td>
                  <td><Badge variant="success" dot>Completed</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {filteredSales.length === 0 && (
            <div className="table-empty">
              <p>No transactions found for this period</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

const PreOrderView = ({ meals, handlePreOrder, isMealAvailable }) => {
  const preOrderMeals = meals.filter(m => !isMealAvailable(m));

  return (
    <div className="preorder-view">
      <div className="preorder-header">
        <div>
          <h1 className="page-title">Pre-Order Menu</h1>
          <p className="page-subtitle">Order ahead for meals that are coming soon</p>
        </div>
        <div className="preorder-stats">
          <Badge variant="info" size="lg">
            <Clock size={14} />
            {preOrderMeals.length} items available for pre-order
          </Badge>
        </div>
      </div>

      <div className="meal-grid">
        {preOrderMeals.map(meal => (
          <Card key={meal.id} className="meal-card" hover padding={false}>
            <div className="meal-card-image-wrapper">
              <img 
                src={meal.image_url || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} 
                alt={meal.name} 
                className="meal-card-image"
              />
              <div className="meal-card-overlay">
                <Badge variant="light" size="xs" className="meal-card-category">
                  {meal.category}
                </Badge>
                <div className="meal-card-time-badge">
                  <Clock size={12} />
                  <span>{meal.available_start} - {meal.available_end}</span>
                </div>
              </div>
            </div>
            
            <div className="meal-card-content">
              <h3 className="meal-card-title">{meal.name}</h3>
              <p className="meal-card-description">{meal.description}</p>
              
              <div className="meal-card-footer">
                <div className="meal-card-price">
                  <span className="meal-card-currency">₵</span>
                  <span className="meal-card-amount">{meal.price.toFixed(2)}</span>
                </div>
                <Button onClick={() => handlePreOrder(meal)} size="sm" icon={Clock}>
                  Pre-Order
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      
      {preOrderMeals.length === 0 && (
        <EmptyState 
          icon={CheckCircle}
          title="All meals are available!"
          description="Every item on our menu is currently available for immediate purchase"
          action={<Button variant="primary">Browse Menu</Button>}
        />
      )}
    </div>
  );
};

const CartView = ({ cart, setActiveTab, removeFromCart, handleCheckout, isProcessingPayment }) => {
  const [phone, setPhone] = useState("");
  const total = cart.reduce((sum, item) => sum + item.meal.price * item.quantity, 0);

  const handlePayment = async () => {
    const paymentCompleted = await handleCheckout(phone);
    if (paymentCompleted) {
      setPhone("");
    }
  };

  return (
    <div className="cart-view">
      <div className="cart-header">
        <h1 className="page-title">Your Cart</h1>
        <Badge variant="default" size="lg">{cart.length} item{cart.length !== 1 ? 's' : ''}</Badge>
      </div>

      {cart.length === 0 ? (
        <EmptyState 
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Looks like you haven't added any items yet"
          action={<Button onClick={() => setActiveTab('browse')} icon={ArrowUpRight}>Browse Menu</Button>}
        />
      ) : (
        <div className="cart-layout">
          <div className="cart-items-section">
            <Card padding={false}>
              <div className="cart-items-header">
                <h3>Order Items</h3>
                <Button variant="ghost" size="sm" className="text-danger">Clear All</Button>
              </div>
              <div className="cart-items-list">
                {cart.map(item => (
                  <motion.div 
                    key={`${item.meal.id}-${item.pickupTime || 'now'}`} 
                    className="cart-item"
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                  >
                    <img src={item.meal.image_url} alt={item.meal.name} className="cart-item-image" />
                    <div className="cart-item-details">
                      <h4 className="cart-item-name">{item.meal.name}</h4>
                      <p className="cart-item-meta">
                        ₵{item.meal.price.toFixed(2)} × {item.quantity}
                      </p>
                      {item.pickupTime && (
                        <Badge variant="info" size="xs">
                          <Clock size={10} /> Pickup: {item.pickupTime}
                        </Badge>
                      )}
                    </div>
                    <div className="cart-item-actions">
                      <span className="cart-item-total">₵{(item.meal.price * item.quantity).toFixed(2)}</span>
                      <IconButton 
                        icon={Trash2} 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => removeFromCart(item.meal.id)}
                        className="text-danger"
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
            </Card>
          </div>

          <div className="cart-summary-section">
            <Card className="cart-summary">
              <h3 className="cart-summary-title">Order Summary</h3>
              
              <div className="cart-summary-rows">
                <div className="cart-summary-row">
                  <span>Subtotal</span>
                  <span>₵{total.toFixed(2)}</span>
                </div>
                <div className="cart-summary-row">
                  <span>Delivery</span>
                  <span className="text-success">Free</span>
                </div>
                <Divider />
                <div className="cart-summary-row cart-summary-total">
                  <span>Total</span>
                  <span>₵{total.toFixed(2)}</span>
                </div>
              </div>

              <Divider label="Payment Method" />
              
              <div className="payment-method">
                <div className="payment-method-option payment-method-active">
                  <Smartphone size={20} />
                  <div>
                    <span className="payment-method-name">Mobile Money</span>
                    <span className="payment-method-desc">Pay with MTN, Vodafone, or AirtelTigo</span>
                  </div>
                </div>
              </div>

              <Input 
                label="MoMo Number"
                type="tel"
                placeholder="Enter your mobile money number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                icon={Smartphone}
              />

              <Button 
                onClick={handlePayment} 
                size="lg" 
                className="cart-checkout-btn"
                disabled={isProcessingPayment || !phone}
                icon={isProcessingPayment ? RefreshCw : CreditCard}
              >
                {isProcessingPayment ? "Processing..." : `Pay ₵${total.toFixed(2)}`}
              </Button>

              <p className="cart-security-note">
                <CheckCircle size={14} />
                Your payment is secure and encrypted
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

const NotificationsView = ({ notifications, fetchData }) => {
  return (
    <div className="notifications-view">
      <div className="notifications-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">Stay updated with your orders and alerts</p>
        </div>
        <Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchData}>
          Refresh
        </Button>
      </div>

      <div className="notifications-list">
        {notifications.map(n => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className="notification-item" hover>
              <div className={`notification-icon notification-icon-${n.type}`}>
                {n.type === 'order' ? <Clock size={20} /> : <CheckCircle size={20} />}
              </div>
              <div className="notification-content">
                <div className="notification-header">
                  <h4 className="notification-title">{n.title}</h4>
                  <span className="notification-time">{new Date(n.timestamp).toLocaleString()}</span>
                </div>
                <p className="notification-message">{n.message}</p>
              </div>
            </Card>
          </motion.div>
        ))}
        
        {notifications.length === 0 && (
          <EmptyState 
            icon={Bell}
            title="No notifications"
            description="You're all caught up! Check back later for updates."
          />
        )}
      </div>
    </div>
  );
};

const FeedbackView = ({ feedbacks, meals, user, fetchData }) => {
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState(5);
  const [mealId, setMealId] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!comment || !mealId) return;

    const feedback = {
      id: Math.random().toString(36).substr(2, 9),
      customer_name: user.name,
      meal_id: mealId,
      comment,
      rating,
      timestamp: new Date().toISOString()
    };

    await SyncService.submitFeedback(feedback);
    setComment("");
    setMealId("");
    setRating(5);
    fetchData();
    alert("Thank you for your feedback!");
  };

  return (
    <div className="feedback-view">
      <div className="feedback-header">
        <div>
          <h1 className="page-title">Customer Feedback</h1>
          <p className="page-subtitle">Share your experience and read what others say</p>
        </div>
      </div>

      <div className="feedback-layout">
        <div className="feedback-form-section">
          <Card className="feedback-form-card">
            <h3 className="feedback-form-title">
              <MessageSquare size={20} />
              Share Your Feedback
            </h3>
            <form onSubmit={handleSubmit} className="feedback-form">
              <Select 
                label="Select Meal"
                options={[
                  { value: "", label: "Choose a meal..." },
                  ...meals.map(m => ({ value: m.id, label: m.name }))
                ]}
                value={mealId}
                onChange={e => setMealId(e.target.value)}
                required
              />

              <div className="rating-input">
                <label className="input-label">Your Rating</label>
                <div className="rating-stars">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className={`rating-star ${rating >= star ? 'rating-star-active' : ''}`}
                    >
                      <Star size={24} fill={rating >= star ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                </div>
              </div>

              <Textarea 
                label="Your Comment"
                placeholder="Tell us about your experience..."
                value={comment}
                onChange={e => setComment(e.target.value)}
                rows={4}
                required
              />

              <Button type="submit" size="lg" icon={MessageSquare}>
                Submit Feedback
              </Button>
            </form>
          </Card>
        </div>

        <div className="feedback-list-section">
          <h3 className="feedback-list-title">Recent Reviews</h3>
          <div className="feedback-list">
            {feedbacks.map(f => (
              <Card key={f.id} className="feedback-item" hover>
                <div className="feedback-item-header">
                  <div className="feedback-author">
                    <Avatar name={f.customer_name} size="md" />
                    <div className="feedback-author-info">
                      <span className="feedback-author-name">{f.customer_name}</span>
                      <span className="feedback-date">{new Date(f.timestamp).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="feedback-rating">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} size={14} fill={i < f.rating ? '#facc15' : 'none'} color={i < f.rating ? '#facc15' : '#e5e7eb'} />
                    ))}
                  </div>
                </div>
                <Badge variant="info" size="sm" className="feedback-meal-badge">
                  {meals.find(m => m.id === f.meal_id)?.name || 'Unknown'}
                </Badge>
                <p className="feedback-comment">"{f.comment}"</p>
              </Card>
            ))}
            
            {feedbacks.length === 0 && (
              <EmptyState 
                icon={MessageSquare}
                title="No feedback yet"
                description="Be the first to share your experience!"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const DashboardView = ({ sales, meals, preorders, user, fetchData }) => {
  const todaySales = sales.filter(s => new Date(s.timestamp).toDateString() === new Date().toDateString());
  const totalRevenue = todaySales.reduce((acc, s) => acc + s.total_price, 0);
  const pendingPreorders = preorders.filter(p => p.status === 'Pending');
  
  const topMeals = useMemo(() => {
    const counts = {};
    todaySales.forEach(s => {
      counts[s.meal_id] = (counts[s.meal_id] || 0) + s.quantity;
    });
    return Object.entries(counts)
      .map(([id, count]) => ({ meal: meals.find(m => m.id === id), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [todaySales, meals]);

  return (
    <div className="dashboard-view">
      <div className="dashboard-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Welcome back! Here's what's happening today.</p>
        </div>
        <div className="dashboard-header-actions">
          <Button variant="outline" size="sm" icon={Calendar}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </Button>
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchData}>
            Refresh
          </Button>
        </div>
      </div>

      <LowStockAlert user={user} meals={meals} />

      <div className="stats-grid">
        <StatCard 
          title="Today's Revenue" 
          value={`₵${totalRevenue.toFixed(2)}`}
          change="+12.5%"
          changeType="up"
          icon={DollarSign}
          variant="primary"
        />
        <StatCard 
          title="Total Orders" 
          value={todaySales.length}
          change="+8.2%"
          changeType="up"
          icon={ShoppingCart}
          variant="blue"
        />
        <StatCard 
          title="Pending Pre-orders" 
          value={pendingPreorders.length}
          icon={Clock}
          variant="orange"
        />
        <StatCard 
          title="Active Menu Items" 
          value={meals.length}
          icon={Package}
          variant="purple"
        />
      </div>

      <div className="dashboard-grid">
        <Card className="dashboard-card">
          <div className="dashboard-card-header">
            <h3 className="dashboard-card-title">
              <TrendingUp size={18} />
              Top Selling Today
            </h3>
            <Button variant="ghost" size="xs">View All</Button>
          </div>
          <div className="top-meals-list">
            {topMeals.map((item, i) => (
              <div key={i} className="top-meal-item">
                <div className="top-meal-rank">{i + 1}</div>
                <div className="top-meal-info">
                  <span className="top-meal-name">{item.meal?.name || "Unknown"}</span>
                  <span className="top-meal-orders">{item.count} orders</span>
                </div>
                <div className="top-meal-trend">
                  <ArrowUpRight size={14} />
                </div>
              </div>
            ))}
            {topMeals.length === 0 && (
              <p className="empty-list-message">No sales data yet today</p>
            )}
          </div>
        </Card>

        <Card className="dashboard-card">
          <div className="dashboard-card-header">
            <h3 className="dashboard-card-title">
              <Clock size={18} />
              Recent Pre-orders
            </h3>
            <Badge variant="warning" size="sm">{pendingPreorders.length} pending</Badge>
          </div>
          <div className="preorders-list">
            {preorders.filter(p => p.status !== 'Collected').slice(0, 5).map((p, i) => (
              <div key={i} className="preorder-item">
                <div className="preorder-item-main">
                  <Avatar name={p.customer_name} size="sm" />
                  <div className="preorder-item-info">
                    <span className="preorder-customer">{p.customer_name}</span>
                    <span className="preorder-meal">{meals.find(m => m.id === p.meal_id)?.name} (x{p.quantity})</span>
                  </div>
                </div>
                <div className="preorder-item-meta">
                  <span className="preorder-time">{p.pickup_time}</span>
                  <Badge variant={p.status === 'Pending' ? 'warning' : 'success'} size="sm">{p.status}</Badge>
                </div>
              </div>
            ))}
            {preorders.length === 0 && (
              <p className="empty-list-message">No pre-orders found</p>
            )}
          </div>
        </Card>
      </div>

      {(user?.role === Role.SELLER || user?.role === Role.ADMIN) && (
        <Card className="preorders-table-card">
          <div className="table-header">
            <h3 className="table-title">
              <Bell size={18} />
              Pre-orders Management
            </h3>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Meal</th>
                  <th>Qty</th>
                  <th>Pickup Time</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {preorders.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div className="table-cell-customer">
                        <Avatar name={p.customer_name} size="sm" />
                        <span>{p.customer_name}</span>
                      </div>
                    </td>
                    <td>{meals.find(m => m.id === p.meal_id)?.name}</td>
                    <td><Badge variant="default" size="sm">{p.quantity}</Badge></td>
                    <td className="text-primary font-medium">{p.pickup_time}</td>
                    <td><Badge variant={p.status === 'Pending' ? 'warning' : 'success'} dot>{p.status}</Badge></td>
                    <td>
                      <div className="table-actions">
                        {p.status === 'Pending' && (
                          <Button onClick={() => SyncService.updatePreOrderStatus(p.id, 'Ready').then(fetchData)} variant="outline" size="xs">
                            Mark Ready
                          </Button>
                        )}
                        {p.status === 'Ready' && (
                          <Button onClick={() => SyncService.updatePreOrderStatus(p.id, 'Collected').then(fetchData)} size="xs">
                            Mark Collected
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

const InventoryView = ({ user, fetchData }) => {
  const [inventory, setInventory] = useState([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingMeal, setEditingMeal] = useState(null);
  const [submittingMeal, setSubmittingMeal] = useState(false);
  const [deletingMealId, setDeletingMealId] = useState(null);
  const [formData, setFormData] = useState({
    name: "", category: "Breakfast Meals", price: "", stock: "",
    description: "", image_url: "", available_start: "08:00", available_end: "10:30"
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  const resetMealForm = () => {
    setIsAdding(false);
    setEditingMeal(null);
    setFormData({
      name: "", category: "Breakfast Meals", price: "", stock: "",
      description: "", image_url: "", available_start: "08:00", available_end: "10:30"
    });
    setImageFile(null);
    setImagePreview(null);
  };

  const openAddMealForm = () => {
    setEditingMeal(null);
    setFormData({
      name: "", category: "Breakfast Meals", price: "", stock: "",
      description: "", image_url: "", available_start: "08:00", available_end: "10:30"
    });
    setImageFile(null);
    setImagePreview(null);
    setIsAdding(true);
  };

  const loadInventory = async () => {
    if (user?.role !== Role.ADMIN) {
      setInventory([]);
      setLoadingInventory(false);
      return;
    }
    setLoadingInventory(true);
    try {
      const data = await SyncService.getInventory(user?.role);
      setInventory(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setInventory([]);
    } finally {
      setLoadingInventory(false);
    }
  };

  useEffect(() => { loadInventory(); }, [user?.role]);

  useEffect(() => {
    if (editingMeal) {
      setFormData({
        name: editingMeal.name, category: editingMeal.category,
        price: editingMeal.price.toString(), stock: editingMeal.stock.toString(),
        description: editingMeal.description || "", image_url: editingMeal.image_url || "",
        available_start: editingMeal.available_start || "08:00",
        available_end: editingMeal.available_end || "10:30"
      });
      setImagePreview(editingMeal.image_url || null);
      setIsAdding(true);
    }
  }, [editingMeal]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingMeal) return;

    try {
      setSubmittingMeal(true);
      const mealData = new FormData();
      mealData.append("id", editingMeal ? editingMeal.id : Math.random().toString(36).substr(2, 9));
      Object.entries(formData).forEach(([key, value]) => mealData.append(key, value));
      if (imageFile) mealData.append("image", imageFile);

      if (editingMeal) {
        await SyncService.updateMeal(mealData, user?.role);
      } else {
        await SyncService.addMeal(mealData, user?.role);
      }

      resetMealForm();
      await fetchData();
      await loadInventory();
      alert("Meal saved successfully!");
    } catch (error) {
      console.error("Error saving meal:", error);
      alert(error.message || "Failed to save meal.");
    } finally {
      setSubmittingMeal(false);
    }
  };

  const handleDeleteMeal = async (meal) => {
    if (!meal?.id || deletingMealId) return;
    const confirmed = window.confirm(`Delete "${meal.name}"?`);
    if (!confirmed) return;

    try {
      setDeletingMealId(meal.id);
      await SyncService.deleteMeal(meal.id, user?.role);
      if (editingMeal?.id === meal.id) resetMealForm();
      await fetchData();
      await loadInventory();
      alert("Meal deleted!");
    } catch (error) {
      console.error("Error deleting meal:", error);
      alert(error.message || "Failed to delete meal.");
    } finally {
      setDeletingMealId(null);
    }
  };

  if (user?.role !== Role.ADMIN) return null;

  return (
    <div className="inventory-view">
      <div className="inventory-header">
        <div>
          <h1 className="page-title">Inventory Management</h1>
          <p className="page-subtitle">Manage your menu items and stock levels</p>
        </div>
        <Button onClick={openAddMealForm} icon={Plus} size="lg">
          Add New Item
        </Button>
      </div>

      {loadingInventory ? (
        <div className="loading-grid">
          {[...Array(8)].map((_, i) => (
            <Card key={i} padding={false}>
              <Skeleton variant="image" height="180px" />
              <div style={{ padding: '1rem' }}>
                <Skeleton variant="text" width="70%" />
                <Skeleton variant="text" width="40%" />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="inventory-grid">
          {inventory.map(meal => (
            <Card key={meal.id} className="inventory-card" hover padding={false}>
              <div className="inventory-card-image-wrapper">
                <img src={meal.image_url || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} alt={meal.name} className="inventory-card-image" />
                <div className="inventory-card-overlay">
                  <Badge variant="light" size="xs">{meal.category}</Badge>
                </div>
              </div>
              <div className="inventory-card-content">
                <div className="inventory-card-header">
                  <h4 className="inventory-card-title">{meal.name}</h4>
                  <span className="inventory-card-price">₵{getMealPrice(meal).toFixed(2)}</span>
                </div>
                <p className="inventory-card-description">{meal.description || "No description"}</p>
                <div className="inventory-card-footer">
                  <div className="inventory-stock">
                    <Package size={14} />
                    <span className={getMealStock(meal) <= getLowStockThreshold(meal) ? 'text-danger' : ''}>
                      {getMealStock(meal)} in stock
                    </span>
                  </div>
                  <div className="inventory-actions">
                    <IconButton icon={Edit3} variant="outline" size="sm" onClick={() => setEditingMeal(meal)} />
                    <IconButton 
                      icon={Trash2} 
                      variant="outline" 
                      size="sm" 
                      className="text-danger"
                      onClick={() => handleDeleteMeal(meal)}
                      disabled={deletingMealId === meal.id}
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}
          
          {inventory.length === 0 && (
            <div className="inventory-empty">
              <EmptyState 
                icon={Package}
                title="No items in inventory"
                description="Start by adding your first menu item"
                action={<Button onClick={openAddMealForm} icon={Plus}>Add Item</Button>}
              />
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {isAdding && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={resetMealForm}
          >
            <motion.div 
              className="modal"
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={e => e.stopPropagation()}
            >
              <div className="modal-header">
                <div>
                  <h2 className="modal-title">{editingMeal ? 'Edit Item' : 'Add New Item'}</h2>
                  <p className="modal-subtitle">Fill in the details below</p>
                </div>
                <IconButton icon={X} variant="ghost" onClick={resetMealForm} />
              </div>
              
              <form onSubmit={handleSubmit} className="modal-body">
                <div className="form-grid">
                  <Input 
                    label="Item Name" 
                    placeholder="e.g. Jollof Rice"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    required
                  />
                  <Select 
                    label="Category"
                    options={[
                      { value: "Breakfast Meals", label: "Breakfast Meals" },
                      { value: "Lunch Meals", label: "Lunch Meals" },
                      { value: "Snacks", label: "Snacks" },
                      { value: "Beverages", label: "Beverages" },
                      { value: "Desserts", label: "Desserts" },
                    ]}
                    value={formData.category}
                    onChange={e => setFormData({...formData, category: e.target.value})}
                  />
                  <Input 
                    label="Price (₵)" 
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.price}
                    onChange={e => setFormData({...formData, price: e.target.value})}
                    required
                  />
                  <Input 
                    label="Stock Quantity" 
                    type="number"
                    placeholder="0"
                    value={formData.stock}
                    onChange={e => setFormData({...formData, stock: e.target.value})}
                    required
                  />
                </div>

                <Textarea 
                  label="Description"
                  placeholder="Describe the item..."
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                />

                <div className="form-grid">
                  <Input 
                    label="Available From" 
                    type="time"
                    value={formData.available_start}
                    onChange={e => setFormData({...formData, available_start: e.target.value})}
                  />
                  <Input 
                    label="Available Until" 
                    type="time"
                    value={formData.available_end}
                    onChange={e => setFormData({...formData, available_end: e.target.value})}
                  />
                </div>

                <div className="image-upload-section">
                  <label className="input-label">Item Image</label>
                  <div className="image-upload-options">
                    <Input 
                      placeholder="Enter image URL"
                      value={formData.image_url}
                      onChange={e => {
                        setFormData({...formData, image_url: e.target.value});
                        setImagePreview(e.target.value);
                        setImageFile(null);
                      }}
                    />
                    <span className="image-upload-divider">or</span>
                    <label className="file-upload-btn">
                      <Upload size={18} />
                      Upload Image
                      <input type="file" accept="image/*" onChange={handleImageChange} hidden />
                    </label>
                  </div>
                  {imagePreview && (
                    <div className="image-preview">
                      <img src={imagePreview} alt="Preview" />
                      <IconButton 
                        icon={X} 
                        variant="dark" 
                        size="sm"
                        className="image-preview-remove"
                        onClick={() => {
                          setImagePreview(null);
                          setImageFile(null);
                          setFormData({...formData, image_url: ""});
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="modal-footer">
                  <Button type="button" variant="outline" onClick={resetMealForm}>Cancel</Button>
                  <Button type="submit" disabled={submittingMeal} icon={submittingMeal ? RefreshCw : CheckCircle}>
                    {submittingMeal ? 'Saving...' : (editingMeal ? 'Update Item' : 'Add Item')}
                  </Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AuthView = ({ handleLogin, handleRegister }) => {
  const [mode, setMode] = useState('login');
  const [selectedRole, setSelectedRole] = useState(Role.ADMIN);
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getRoleLabel = (role) => {
    if (role === Role.ADMIN) return 'Administrator';
    if (role === Role.SELLER) return 'Seller';
    if (role === Role.BUYER) return 'Student / Faculty';
    return 'User';
  };

  const selectedRoleLabel = getRoleLabel(selectedRole);

  const selectRole = (role) => {
    setSelectedRole(role);
    setError('');
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (mode === 'register') {
        if (!formData.name || !formData.email || !formData.password) {
          throw new Error('Please fill in your name, email, and password.');
        }
        if (formData.password.length < 6) {
          throw new Error('Password must be at least 6 characters long.');
        }
        if (formData.password !== formData.confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        await handleRegister({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: selectedRole,
        });
      } else {
        if (!formData.email || !formData.password) {
          throw new Error('Email and password are required.');
        }

        await handleLogin(selectedRole, formData.email, formData.password);
      }
    } catch (err) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <Utensils size={32} />
            </div>
            <h1 className="login-title">EBD Inventory</h1>
            <p className="login-subtitle">School Cafeteria Management System</p>
          </div>

          <div className="login-body">
            <p className="login-instruction">Select your role to continue</p>

            <div className="login-buttons">
              <button type="button" className={`login-role-btn login-role-admin ${selectedRole === Role.ADMIN ? 'login-role-btn-selected' : ''}`} onClick={() => selectRole(Role.ADMIN)}>
                <div className="login-role-icon">
                  <Settings size={24} />
                </div>
                <div className="login-role-info">
                  <span className="login-role-name">{getRoleLabel(Role.ADMIN)}</span>
                  <span className="login-role-desc">Full system access</span>
                </div>
                <ChevronRight size={20} />
              </button>

              <button type="button" className={`login-role-btn login-role-seller ${selectedRole === Role.SELLER ? 'login-role-btn-selected' : ''}`} onClick={() => selectRole(Role.SELLER)}>
                <div className="login-role-icon">
                  <Utensils size={24} />
                </div>
                <div className="login-role-info">
                  <span className="login-role-name">{getRoleLabel(Role.SELLER)}</span>
                  <span className="login-role-desc">Manage orders & sales</span>
                </div>
                <ChevronRight size={20} />
              </button>

              <button type="button" className={`login-role-btn login-role-buyer ${selectedRole === Role.BUYER ? 'login-role-btn-selected' : ''}`} onClick={() => selectRole(Role.BUYER)}>
                <div className="login-role-icon">
                  <Users size={24} />
                </div>
                <div className="login-role-info">
                  <span className="login-role-name">{getRoleLabel(Role.BUYER)}</span>
                  <span className="login-role-desc">Browse & order meals</span>
                </div>
                <ChevronRight size={20} />
              </button>
            </div>

            <div className="auth-toggle-row">
              <button type="button" className={`auth-toggle ${mode === 'login' ? 'auth-toggle-active' : ''}`} onClick={() => setMode('login')}>
                Login
              </button>
              <button type="button" className={`auth-toggle ${mode === 'register' ? 'auth-toggle-active' : ''}`} onClick={() => setMode('register')}>
                Register
              </button>
            </div>

            <form onSubmit={onSubmit} className="login-form">
              {mode === 'register' && (
                <Input
                  label="Full name"
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="Jane Doe"
                />
              )}

              <Input
                label="Email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="name@domain.com"
              />

              <Input
                label="Password"
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Enter password"
              />

              {mode === 'register' && (
                <Input
                  label="Confirm password"
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  placeholder="Confirm password"
                />
              )}

              {error && <div className="login-error">{error}</div>}

              <Button type="submit" size="lg" className="login-submit" disabled={isSubmitting}>
                {isSubmitting ? (mode === 'login' ? 'Signing in...' : 'Creating account...') : mode === 'login' ? `Sign in as ${selectedRoleLabel}` : `Create ${selectedRoleLabel} account`}
              </Button>
            </form>
          </div>

          <div className="login-footer">
            <p>Need help? <a href="#">Contact support</a></p>
          </div>
        </div>

        <div className="login-illustration">
          <div className="login-illustration-content">
            <Sparkles size={48} />
            <h2>Fresh & Delicious</h2>
            <p>Order your favorite meals from the school cafeteria with ease</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [meals, setMeals] = useState(DEFAULT_MEALS);
  const [sales, setSales] = useState([]);
  const [preorders, setPreorders] = useState([]);
  const [feedbacks, setFeedbacks] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [cart, setCart] = useState([]);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
      SyncService.syncOutbox();
      fetchData();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    const [m, s, p, f, n] = await Promise.all([
      SyncService.getMeals(),
      SyncService.getSales(),
      SyncService.getPreOrders(),
      SyncService.getFeedback(),
      SyncService.getNotifications()
    ]);
    setMeals(Array.isArray(m) ? m : []);
    setSales(Array.isArray(s) ? s : []);
    setPreorders(Array.isArray(p) ? p : []);
    setFeedbacks(Array.isArray(f) ? f : []);
    setNotifications(Array.isArray(n) ? n : []);
  };

  useEffect(() => {
    if (activeTab === 'inventory' && user?.role !== Role.ADMIN) {
      setActiveTab('dashboard');
    }
  }, [activeTab, user]);

  const handleLogin = async (role, email, password) => {
    const userData = await SyncService.login({ email, password, role });
    setUser(userData);
    setActiveTab(role === Role.BUYER ? 'browse' : 'dashboard');
  };

  const handleRegister = async ({ name, email, password, role }) => {
    const userData = await SyncService.register({ name, email, password, role });
    setUser(userData);
    setActiveTab(role === Role.BUYER ? 'browse' : 'dashboard');
  };

  const handleLogout = () => {
    setUser(null);
    setCart([]);
  };

  const isMealAvailable = (meal) => {
    const now = currentTime.getHours() * 60 + currentTime.getMinutes();
    const [startH, startM] = meal.available_start.split(':').map(Number);
    const [endH, endM] = meal.available_end.split(':').map(Number);
    return now >= startH * 60 + startM && now <= endH * 60 + endM;
  };

  const getRemainingTime = (meal) => {
    const now = currentTime.getHours() * 60 + currentTime.getMinutes();
    const [endH, endM] = meal.available_end.split(':').map(Number);
    const diff = endH * 60 + endM - now;
    if (diff <= 0) return "Ended";
    return `${Math.floor(diff / 60)}h ${diff % 60}m left`;
  };

  const addToCart = (meal, pickupTime = null) => {
    setCart(prev => {
      const existing = prev.find(item => item.meal.id === meal.id && item.pickupTime === pickupTime);
      if (existing) {
        return prev.map(item => 
          (item.meal.id === meal.id && item.pickupTime === pickupTime) 
            ? { ...item, quantity: item.quantity + 1 } 
            : item
        );
      }
      return [...prev, { meal, quantity: 1, pickupTime }];
    });
  };

  const removeFromCart = (mealId) => {
    setCart(prev => prev.filter(item => item.meal.id !== mealId));
  };

  const handlePreOrder = (meal) => {
    const time = window.prompt("Enter pickup time (e.g. 12:30):", "12:30");
    if (time) {
      addToCart(meal, time);
      setActiveTab('cart');
    }
  };

  const handleCheckout = async (phone) => {
    if (cart.length === 0) return false;
    if (!isValidMoMoNumber(phone)) {
      alert("Enter a valid MoMo number");
      return false;
    }

    setIsProcessingPayment(true);
    try {
      await SyncService.processPayment({ phone, cart, customer_name: user?.name || "Guest" });
      alert("Payment successful!");
      setCart([]);
      await fetchData();
      return true;
    } catch (error) {
      alert(error.message || "Payment failed.");
      return false;
    } finally {
      setIsProcessingPayment(false);
    }
  };

  if (!user) return <AuthView handleLogin={handleLogin} handleRegister={handleRegister} />;

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [Role.ADMIN, Role.SELLER] },
    { id: 'reports', label: 'Analytics', icon: TrendingUp, roles: [Role.ADMIN, Role.SELLER] },
    { id: 'browse', label: 'Menu', icon: Utensils, roles: [Role.BUYER] },
    { id: 'preorders', label: 'Pre-Orders', icon: Clock, roles: [Role.BUYER] },
    { id: 'inventory', label: 'Inventory', icon: Package, roles: [Role.ADMIN] },
    { id: 'cart', label: 'Cart', icon: ShoppingCart, roles: [Role.BUYER], count: cart.length },
    { id: 'notifications', label: 'Notifications', icon: Bell, roles: [Role.ADMIN, Role.SELLER] },
    { id: 'feedback', label: 'Feedback', icon: MessageSquare, roles: [Role.ADMIN, Role.SELLER, Role.BUYER] },
  ];

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">
              <Utensils size={24} />
            </div>
            {!sidebarCollapsed && (
              <div className="sidebar-logo-text">
                <span className="sidebar-logo-title">EBD</span>
                <span className="sidebar-logo-subtitle">Inventory</span>
              </div>
            )}
          </div>
          <IconButton 
            icon={sidebarCollapsed ? ChevronRight : ChevronLeft} 
            variant="ghost" 
            size="sm"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="sidebar-toggle"
          />
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-nav-section">
            {!sidebarCollapsed && <span className="sidebar-nav-label">Menu</span>}
            {menuItems.filter(item => item.roles.includes(user.role)).map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`sidebar-nav-item ${activeTab === item.id ? 'sidebar-nav-item-active' : ''}`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <item.icon size={20} />
                {!sidebarCollapsed && <span>{item.label}</span>}
                {item.count > 0 && (
                  <span className="sidebar-nav-badge">{item.count}</span>
                )}
              </button>
            ))}
          </div>
        </nav>

        <div className="sidebar-footer">
          {!sidebarCollapsed && (
            <div className="sidebar-user">
              <Avatar name={user.name} size="md" status="online" />
              <div className="sidebar-user-info">
                <span className="sidebar-user-name">{user.name}</span>
                <Badge variant="default" size="xs">{user.role}</Badge>
              </div>
            </div>
          )}
          <button className="sidebar-logout" onClick={handleLogout} title="Logout">
            <LogOut size={20} />
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="main-header">
          <div className="header-left">
            <IconButton 
              icon={Menu} 
              variant="ghost" 
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="header-menu-btn"
            />
            <div className="header-breadcrumb">
              <span className="header-breadcrumb-item">Home</span>
              <ChevronRight size={14} />
              <span className="header-breadcrumb-current">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</span>
            </div>
          </div>
          
          <div className="header-right">
            <div className="header-time">
              <span className="header-time-value">
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="header-time-date">
                {currentTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
            </div>
            
            <IconButton icon={Bell} variant="ghost" badge={notifications.length || undefined} />
            <IconButton icon={Settings} variant="ghost" />
            
            <div className="header-user">
              <Avatar name={user.name} size="sm" status="online" />
            </div>
          </div>
        </header>

        <div className="main-body">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="main-content-wrapper"
            >
              {activeTab === 'dashboard' && <DashboardView sales={sales} meals={meals} preorders={preorders} user={user} fetchData={fetchData} />}
              {activeTab === 'reports' && <ReportsView sales={sales} meals={meals} preorders={preorders} user={user} fetchData={fetchData} />}
              {activeTab === 'inventory' && user.role === Role.ADMIN && <InventoryView user={user} fetchData={fetchData} />}
              {activeTab === 'browse' && <BrowseView meals={meals} cart={cart} addToCart={addToCart} handlePreOrder={handlePreOrder} isMealAvailable={isMealAvailable} getRemainingTime={getRemainingTime} />}
              {activeTab === 'preorders' && <PreOrderView meals={meals} handlePreOrder={handlePreOrder} isMealAvailable={isMealAvailable} />}
              {activeTab === 'cart' && <CartView cart={cart} setActiveTab={setActiveTab} removeFromCart={removeFromCart} handleCheckout={handleCheckout} isProcessingPayment={isProcessingPayment} />}
              {activeTab === 'notifications' && <NotificationsView notifications={notifications} fetchData={fetchData} />}
              {activeTab === 'feedback' && <FeedbackView feedbacks={feedbacks} meals={meals} user={user} fetchData={fetchData} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}