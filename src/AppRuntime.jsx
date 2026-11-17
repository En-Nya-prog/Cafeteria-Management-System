import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  RefreshCw,
  CheckCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CATEGORY_TIMES } from './constants.js';
import { Role } from './types.js';
import { SyncService } from './services/SyncServiceRuntime.js';
import loginIllustration from '../uploads/1774479222772-882267974.png';
import './App.css';

const handleMealImageError = (event) => {
  const image = event.currentTarget;
  image.onerror = null;
  image.src = loginIllustration;
};

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

const Card = ({ children, className = "", hover = false, padding = true, ...props }) => (
  <div className={`card ${hover ? 'card-hover' : ''} ${padding ? 'card-padding' : ''} ${className}`} {...props}>
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
                      onError={handleMealImageError}
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
                onError={handleMealImageError}
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
  const total = cart.reduce((sum, item) => sum + item.meal.price * item.quantity, 0);

  const handlePayment = async () => {
    await handleCheckout();
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
                    <img src={item.meal.image_url || loginIllustration} alt={item.meal.name} className="cart-item-image" onError={handleMealImageError} />
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
                    <span className="payment-method-name">Secure checkout with Paystack</span>
                    <span className="payment-method-desc">Choose Mobile Money or card on the secure checkout page</span>
                  </div>
                </div>
              </div>

              <Button 
                onClick={handlePayment} 
                size="lg" 
                className="cart-checkout-btn"
                disabled={isProcessingPayment}
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

const NotificationsView = ({ notifications, setNotifications, fetchData, user }) => {
  const [preferences, setPreferences] = useState(null);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");

  useEffect(() => {
    if (user?.role !== Role.BUYER) return;
    SyncService.getNotificationPreferences().then(setPreferences).catch((error) => {
      setPreferenceMessage(error.message || "Unable to load notification settings.");
    });
  }, [user?.role]);

  const unreadCount = useMemo(() => {
    return [Role.BUYER, Role.SELLER].includes(user?.role)
      ? notifications.filter((n) => !n.read_at).length
      : 0;
  }, [notifications, user?.role]);

  const handleNotificationClick = async (notification) => {
    if (!notification || notification.read_at || ![Role.BUYER, Role.SELLER].includes(user?.role)) {
      return;
    }

    const readAt = new Date().toISOString();
    const userKey = user?.id ? `read_notifications_${user.id}` : "read_notifications";

    // Persist to localStorage immediately so background polling never overwrites it
    try {
      const localReadMap = JSON.parse(localStorage.getItem(userKey) || "{}");
      localReadMap[notification.id] = readAt;
      localStorage.setItem(userKey, JSON.stringify(localReadMap));
    } catch (e) {
      console.warn("Unable to save read state to localStorage:", e);
    }

    // Optimistically update notifications state so the badge and UI update immediately
    if (setNotifications) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read_at: readAt } : n))
      );
    }

    try {
      await SyncService.markNotificationAsRead(notification.id);
    } catch (error) {
      console.error("Unable to mark notification as read on server:", error);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (![Role.BUYER, Role.SELLER].includes(user?.role) || unreadCount === 0) return;

    const readAt = new Date().toISOString();
    const userKey = user?.id ? `read_notifications_${user.id}` : "read_notifications";

    try {
      const localReadMap = JSON.parse(localStorage.getItem(userKey) || "{}");
      notifications.forEach((n) => {
        localReadMap[n.id] = readAt;
      });
      localStorage.setItem(userKey, JSON.stringify(localReadMap));
    } catch (e) {
      console.warn("Unable to save read state to localStorage:", e);
    }

    if (setNotifications) {
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read_at: n.read_at || readAt }))
      );
    }

    try {
      await SyncService.markNotificationsAsRead();
    } catch (error) {
      console.error("Unable to mark all notifications as read on server:", error);
    }
  };

  const savePreferences = async (event) => {
    event.preventDefault();
    if (!preferences || isSavingPreferences) return;
    setIsSavingPreferences(true);
    setPreferenceMessage("");
    try {
      await SyncService.saveNotificationPreferences(preferences);
      setPreferenceMessage("Notification settings saved.");
    } catch (error) {
      setPreferenceMessage(error.message || "Unable to save notification settings.");
    } finally {
      setIsSavingPreferences(false);
    }
  };

  return (
    <div className="notifications-view">
      <div className="notifications-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">Stay updated with your orders and alerts</p>
        </div>
        <div className="notifications-header-actions" style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {[Role.BUYER, Role.SELLER].includes(user?.role) && unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              icon={CheckCheck}
              onClick={handleMarkAllAsRead}
            >
              Mark all as read
            </Button>
          )}
          <Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchData}>
            Refresh
          </Button>
        </div>
      </div>

      {user?.role === Role.BUYER && preferences && (
        <Card className="feedback-form-card">
          <h3 className="feedback-form-title">New meal alerts</h3>
          <p className="page-subtitle">Choose how you want to hear about newly listed foods. In-app alerts are always on.</p>
          <form onSubmit={savePreferences} className="feedback-form">
            <label className="input-label">
              <input
                type="checkbox"
                checked={preferences.email_opt_in}
                onChange={(event) => setPreferences({ ...preferences, email_opt_in: event.target.checked })}
              />{" "}
              Email announcements
            </label>
            <label className="input-label">
              <input
                type="checkbox"
                checked={preferences.sms_opt_in}
                onChange={(event) => setPreferences({ ...preferences, sms_opt_in: event.target.checked })}
              />{" "}
              SMS announcements
            </label>
            <Input
              label="Mobile number for SMS (international format)"
              type="tel"
              placeholder="+233241234567"
              autoComplete="tel"
              value={preferences.phone}
              onChange={(event) => setPreferences({ ...preferences, phone: event.target.value })}
              required={preferences.sms_opt_in}
            />
            <p className="page-subtitle">SMS messages may incur charges from your mobile provider. You can change these choices anytime.</p>
            {preferenceMessage && <p role="status" aria-live="polite">{preferenceMessage}</p>}
            <Button type="submit" disabled={isSavingPreferences}>
              {isSavingPreferences ? "Saving..." : "Save notification settings"}
            </Button>
          </form>
        </Card>
      )}
      {user?.role === Role.BUYER && !preferences && (
        <p role={preferenceMessage ? "alert" : "status"} aria-live="polite">
          {preferenceMessage || "Loading notification settings..."}
        </p>
      )}

      <div className="notifications-list">
        {notifications.map(n => {
          const isUnread = !n.read_at && user?.role === Role.BUYER;
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card
                className={`notification-item ${isUnread ? 'notification-item-unread' : 'notification-item-read'}`}
                hover
                onClick={() => handleNotificationClick(n)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNotificationClick(n);
                  }
                }}
              >
                <div className={`notification-icon notification-icon-${n.type}`}>
                  {n.type === 'order' ? <Clock size={20} /> : n.type === 'meal' ? <Package size={20} /> : <CheckCircle size={20} />}
                </div>
                <div className="notification-content">
                  <div className="notification-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <h4 className="notification-title">{n.title}</h4>
                      {isUnread && (
                        <Badge variant="primary" size="xs" dot>
                          New
                        </Badge>
                      )}
                    </div>
                    <span className="notification-time">{new Date(n.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="notification-message">{n.message}</p>
                </div>
              </Card>
            </motion.div>
          );
        })}
        
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

const OrdersView = ({ sales, meals, fetchData }) => {
  const [saving, setSaving] = useState(null);
  const statusLabel = (value) => ({ new: "New Order", accepted: "Accepted", preparing: "Preparing", ready: "Ready for Pickup", completed: "Completed", cancelled: "Cancelled" }[value] || value || "New Order");
  const advance = async (sale, status) => {
    setSaving(sale.id);
    try { await SyncService.updateOrderStatus(sale.id, status); await fetchData(); }
    catch (error) { alert(error.message || "Unable to update order."); }
    finally { setSaving(null); }
  };
  const actions = (sale) => {
    const status = sale.assignment_status || sale.order_status || "new";
    if (status === "new") return <Button size="xs" disabled={saving === sale.id} onClick={() => advance(sale, "accepted")}>Accept</Button>;
    if (status === "accepted") return <Button size="xs" disabled={saving === sale.id} onClick={() => advance(sale, "preparing")}>Start Preparing</Button>;
    if (status === "preparing") return <Button size="xs" disabled={saving === sale.id} onClick={() => advance(sale, "ready")}>Ready for Pickup</Button>;
    if (status === "ready") return <Button size="xs" disabled={saving === sale.id} onClick={() => advance(sale, "completed")}>Complete</Button>;
    return null;
  };
  return <div className="dashboard-view">
    <div className="dashboard-header"><div><h1 className="page-title">Orders</h1><p className="page-subtitle">Orders for your meals and the shared cafeteria menu</p></div><Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchData}>Refresh</Button></div>
    <Card className="preorders-table-card"><div className="table-wrapper"><table className="data-table"><thead><tr><th>Order reference</th><th>Meal</th><th>Buyer</th><th>Qty</th><th>Amount</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {sales.map((sale) => <tr key={sale.id}><td>{sale.order_reference || sale.id.slice(0, 8)}</td><td>{sale.meal_name || meals.find((m) => m.id === sale.meal_id)?.name || "Meal"}</td><td>{sale.customer_name || "Buyer"}</td><td>{sale.quantity}</td><td>₵{Number(sale.total_price || 0).toFixed(2)}</td><td><Badge variant={sale.payment_status === "paid" ? "success" : "warning"}>{sale.payment_status || "Recorded"}</Badge></td><td><Badge variant={sale.assignment_status === "ready" ? "success" : "default"}>{statusLabel(sale.assignment_status || sale.order_status)}</Badge></td><td>{actions(sale)}</td></tr>)}
      {sales.length === 0 && <tr><td colSpan="8">No orders yet.</td></tr>}
    </tbody></table></div></Card>
  </div>;
};

const BuyerOrdersView = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try { setOrders(await SyncService.getMyOrders()); }
    catch (error) { console.error("Unable to load buyer orders:", error); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, []);
  const label = (value) => ({ new: "New Order", accepted: "Accepted", preparing: "Preparing", ready: "Ready for Pickup", completed: "Completed", cancelled: "Cancelled" }[value] || "New Order");
  return <div className="dashboard-view"><div className="dashboard-header"><div><h1 className="page-title">My Orders</h1><p className="page-subtitle">Track your recent orders and pickup readiness</p></div><Button variant="outline" size="sm" icon={RefreshCw} onClick={refresh}>Refresh</Button></div>
    <Card className="preorders-table-card"><div className="table-wrapper"><table className="data-table"><thead><tr><th>Reference</th><th>Meal</th><th>Qty</th><th>Amount</th><th>Payment</th><th>Status</th><th>Ordered</th></tr></thead><tbody>
      {orders.map((order) => <tr key={order.id}><td>{order.order_reference || order.id.slice(0, 8)}</td><td>{order.meal_name}</td><td>{order.quantity}</td><td>₵{Number(order.total_price || 0).toFixed(2)}</td><td>{order.payment_status || "Recorded"}</td><td><Badge variant={order.assignment_status === "ready" ? "success" : "default"}>{label(order.assignment_status || order.order_status)}</Badge></td><td>{new Date(order.timestamp).toLocaleString()}</td></tr>)}
      {!loading && orders.length === 0 && <tr><td colSpan="7">You have no orders yet.</td></tr>}
      {loading && <tr><td colSpan="7">Loading orders…</td></tr>}
    </tbody></table></div></Card>
  </div>;
};

const SellerPreOrdersView = ({ preorders, meals, fetchData }) => {
  const [saving, setSaving] = useState(null);
  const change = async (item, status) => {
    setSaving(item.id);
    try { await SyncService.updatePreOrderStatus(item.id, status); await fetchData(); }
    catch (error) { alert(error.message || "Unable to update pre-order."); }
    finally { setSaving(null); }
  };
  const actionFor = (item) => {
    const next = ({ Pending: "Accepted", Accepted: "Preparing", Preparing: "Ready", Ready: "Completed" })[item.status];
    const label = ({ Pending: "Accept", Accepted: "Start Preparing", Preparing: "Ready for Pickup", Ready: "Complete" })[item.status];
    return next ? <Button size="xs" disabled={saving === item.id} onClick={() => change(item, next)}>{label}</Button> : null;
  };
  return <div className="dashboard-view"><div className="dashboard-header"><div><h1 className="page-title">Pre-Orders</h1><p className="page-subtitle">Future pickup requests for shared and seller meals</p></div><Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchData}>Refresh</Button></div>
    <Card className="preorders-table-card"><div className="table-wrapper"><table className="data-table"><thead><tr><th>Reference</th><th>Meal</th><th>Buyer</th><th>Qty</th><th>Pickup time</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {preorders.map((item) => <tr key={item.id}><td>{item.id.slice(0, 8)}</td><td>{item.meal_name || meals.find((m) => m.id === item.meal_id)?.name || "Meal"}</td><td>{item.customer_name}</td><td>{item.quantity}</td><td>{item.pickup_time}</td><td>{item.payment_status || "Unpaid"}</td><td><Badge>{item.status}</Badge></td><td>{actionFor(item)}</td></tr>)}
      {preorders.length === 0 && <tr><td colSpan="8">No pre-orders yet.</td></tr>}
    </tbody></table></div></Card>
  </div>;
};

const DashboardView = ({ sales, meals, preorders, user, fetchData }) => {
  const todaySales = sales.filter(s => new Date(s.timestamp).toDateString() === new Date().toDateString());
  const totalRevenue = todaySales.reduce((acc, s) => acc + s.total_price, 0);
  const pendingPreorders = preorders.filter(p => p.status === 'Pending');
  const orderStatus = (sale) => sale.assignment_status || sale.order_status || 'new';
  
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
        {user?.role === Role.SELLER ? <>
          <StatCard title="Available Meals" value={meals.filter((meal) => Number(meal.stock) > 0 && (!meal.availability_status || meal.availability_status === "available")).length} icon={Package} variant="primary" />
          <StatCard title="New Orders" value={sales.filter((sale) => orderStatus(sale) === 'new').length} icon={ShoppingCart} variant="blue" />
          <StatCard title="Pending Pre-Orders" value={pendingPreorders.length} icon={Clock} variant="orange" />
          <StatCard title="Preparing / Ready" value={sales.filter((sale) => ['preparing', 'ready'].includes(orderStatus(sale))).length} icon={Utensils} variant="purple" />
        </> : <>
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
        </>}
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
    description: "", image_url: "", available_start: "08:00", available_end: "10:30", availability_status: "available"
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);

  const resetMealForm = () => {
    setIsAdding(false);
    setEditingMeal(null);
    setFormData({
      name: "", category: "Breakfast Meals", price: "", stock: "",
      description: "", image_url: "", available_start: "08:00", available_end: "10:30", availability_status: "available"
    });
    setImageFile(null);
    setImagePreview(null);
  };

  const openAddMealForm = () => {
    setEditingMeal(null);
    setFormData({
      name: "", category: "Breakfast Meals", price: "", stock: "",
      description: "", image_url: "", available_start: "08:00", available_end: "10:30", availability_status: "available"
    });
    setImageFile(null);
    setImagePreview(null);
    setIsAdding(true);
  };

  const loadInventory = async () => {
    if (![Role.ADMIN, Role.SELLER].includes(user?.role)) {
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
        available_end: editingMeal.available_end || "10:30",
        availability_status: editingMeal.availability_status || "available"
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

      const result = editingMeal
        ? await SyncService.updateMeal(mealData, user?.role)
        : await SyncService.addMeal(mealData, user?.role);

      resetMealForm();
      await fetchData();
      await loadInventory();
      const notificationSummary = result?.notifications
        ? ` ${result.notifications.inApp} buyers notified in-app; email ${result.notifications.email.sent} sent/${result.notifications.email.failed} failed; SMS ${result.notifications.sms.sent} sent/${result.notifications.sms.failed} failed.`
        : result?.notificationError
          ? ` ${result.notificationError}`
          : "";
      alert(`Meal saved successfully!${notificationSummary}`);
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

  if (![Role.ADMIN, Role.SELLER].includes(user?.role)) return null;
  const isAdmin = user.role === Role.ADMIN;

  return (
    <div className="inventory-view">
      <div className="inventory-header">
        <div>
          <h1 className="page-title">{isAdmin ? "Inventory Management" : "My Foods"}</h1>
          <p className="page-subtitle">
            {isAdmin ? "Manage all menu items and stock levels" : "Add and manage the foods you offer"}
          </p>
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
                <img src={meal.image_url || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400"} alt={meal.name} className="inventory-card-image" onError={handleMealImageError} />
                <div className="inventory-card-overlay">
                  <Badge variant="light" size="xs">{meal.category}</Badge>
                  <Badge variant="light" size="xs">{meal.seller_id ? (meal.seller_id === user?.id ? "My meal" : "Seller meal") : "Administrator meal"}</Badge>
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
                    {(isAdmin || meal.seller_id === user?.id) && <IconButton icon={Edit3} variant="outline" size="sm" onClick={() => setEditingMeal(meal)} />}
                    {(isAdmin || meal.seller_id === user?.id) && <IconButton
                      icon={Trash2} 
                      variant="outline" 
                      size="sm" 
                      className="text-danger"
                      onClick={() => handleDeleteMeal(meal)}
                      disabled={deletingMealId === meal.id}
                    />}
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

                <label className="input-label" htmlFor="meal-availability">Meal availability</label>
                <select id="meal-availability" className="form-input" value={formData.availability_status} onChange={e => setFormData({...formData, availability_status: e.target.value})}>
                  <option value="available">Available</option>
                  <option value="unavailable">Temporarily unavailable</option>
                  <option value="sold_out">Sold out</option>
                </select>

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


const SellersView = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });

  const [sellers, setSellers] = useState([]);
  const [search, setSearch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingSeller, setEditingSeller] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingSellerId, setDeletingSellerId] = useState(null);

  const loadSellers = async () => {
    setIsLoading(true);
    setError("");

    try {
      const data = await SyncService.getSellers();
      setSellers(data);
    } catch (err) {
      setError(err.message || "Unable to load registered sellers.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSellers();
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setMessage("");
    setError("");

    try {
      const seller = await SyncService.createSeller(formData);

      setFormData({
        name: "",
        email: "",
        password: "",
      });

      setMessage(
        `Seller account created for ${seller.name} (${seller.email}). Share the temporary password securely.`
      );

      await loadSellers();
    } catch (err) {
      setError(err.message || "Unable to create seller account.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const beginEdit = (seller) => {
    setEditingSeller(seller);
    setEditForm({ name: seller.name || "", email: seller.email || "", phone: seller.phone || "", password: "" });
    setMessage("");
    setError("");
  };

  const handleEditSubmit = async (event) => {
    event.preventDefault();
    if (!editingSeller || isSavingEdit) return;
    setIsSavingEdit(true);
    setMessage("");
    setError("");
    try {
      const updatedSeller = await SyncService.updateSeller(editingSeller.id, editForm);
      setEditingSeller(null);
      setMessage(`Seller account updated for ${updatedSeller.name}.`);
      await loadSellers();
    } catch (err) {
      setError(err.message || "Unable to update seller account.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDelete = async (seller) => {
    if (!seller?.id || deletingSellerId) return;
    if (!window.confirm(`Delete seller account for ${seller.name}? Their meals will remain in the shared inventory and be unassigned.`)) return;
    setDeletingSellerId(seller.id);
    setMessage("");
    setError("");
    try {
      await SyncService.deleteSeller(seller.id);
      if (editingSeller?.id === seller.id) setEditingSeller(null);
      setMessage(`Seller account for ${seller.name} was deleted.`);
      await loadSellers();
    } catch (err) {
      setError(err.message || "Unable to delete seller account.");
    } finally {
      setDeletingSellerId(null);
    }
  };

  const filteredSellers = sellers.filter((seller) => {
    const query = search.toLowerCase();

    return (
      seller.name?.toLowerCase().includes(query) ||
      seller.email?.toLowerCase().includes(query) ||
      seller.phone?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="seller-management-view">
      <div className="inventory-header">
        <div>
          <h1 className="page-title">Seller Accounts</h1>
          <p className="page-subtitle">
            Create and manage cafeteria seller accounts
          </p>
        </div>
      </div>

      <Card className="feedback-form-card">
        <form onSubmit={handleSubmit} className="feedback-form">
          <h3>Create New Seller</h3>

          <Input
            label="Seller Name"
            name="name"
            autoComplete="name"
            maxLength={120}
            value={formData.name}
            onChange={(event) =>
              setFormData({ ...formData, name: event.target.value })
            }
            required
          />

          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            value={formData.email}
            onChange={(event) =>
              setFormData({ ...formData, email: event.target.value })
            }
            required
          />

          <Input
            label="Temporary Password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            value={formData.password}
            onChange={(event) =>
              setFormData({ ...formData, password: event.target.value })
            }
            required
          />

          <p className="page-subtitle">
            Use at least 10 characters. Share the temporary password
            with the seller privately.
          </p>

          {message && (
            <p role="status" aria-live="polite">{message}</p>
          )}

          {error && (
            <p role="alert" style={{ color: "red" }}>{error}</p>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            icon={Users}
          >
            {isSubmitting ? "Creating account..." : "Create Seller Account"}
          </Button>
        </form>
      </Card>

      {editingSeller && (
        <Card className="feedback-form-card">
          <form onSubmit={handleEditSubmit} className="feedback-form">
            <h3>Edit Seller: {editingSeller.name}</h3>
            <Input label="Seller Name" value={editForm.name} maxLength={120} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} required />
            <Input label="Email" type="email" value={editForm.email} maxLength={254} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} required />
            <Input label="Phone Number" type="tel" value={editForm.phone} maxLength={40} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} />
            <Input label="Reset Password (optional)" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={editForm.password} onChange={(event) => setEditForm({ ...editForm, password: event.target.value })} />
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button type="submit" disabled={isSavingEdit} icon={CheckCircle}>{isSavingEdit ? "Saving..." : "Save Changes"}</Button>
              <Button type="button" variant="outline" onClick={() => setEditingSeller(null)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="table-card">
        <div className="table-header">
          <div>
            <h3 className="table-title">Registered Sellers</h3>
            <p className="page-subtitle">
              {sellers.length} seller account{sellers.length !== 1 ? "s" : ""}
              {" "}registered
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            icon={RefreshCw}
            onClick={loadSellers}
            disabled={isLoading}
          >
            Refresh
          </Button>
        </div>

        <div className="search-container">
          <Search className="search-icon" size={20} />
          <input
            type="text"
            placeholder="Search sellers by name, email or phone..."
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {error && (
          <p role="alert" style={{ color: "red", padding: "12px" }}>
            {error}
          </p>
        )}

        {isLoading ? (
          <div className="table-empty">
            Loading registered sellers...
          </div>
        ) : filteredSellers.length === 0 ? (
          <div className="table-empty">
            {sellers.length === 0
              ? "No seller accounts have been registered yet."
              : "No sellers match your search."}
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Seller Name</th>
                  <th>Email Address</th>
                  <th>Phone Number</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredSellers.map((seller) => (
                  <tr key={seller.id}>
                    <td>{seller.name}</td>
                    <td>{seller.email}</td>
                    <td>{seller.phone || "Not provided"}</td>
                    <td>
                      <div className="table-actions">
                        <Button variant="outline" size="xs" icon={Edit3} onClick={() => beginEdit(seller)}>Edit</Button>
                        <Button variant="outline" size="xs" icon={Trash2} className="text-danger" disabled={deletingSellerId === seller.id} onClick={() => handleDelete(seller)}>
                          {deletingSellerId === seller.id ? "Deleting..." : "Delete"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
        if (formData.password.length < 10) {
          throw new Error('Password must be at least 10 characters long.');
        }
        if (formData.password !== formData.confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        await handleRegister({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          role: Role.BUYER,
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
            <h1 className="login-title">E<sup>3</sup> Inventory</h1>
            <p className="login-subtitle">Palm Cafeteria Management System</p>
          </div>

          <div className="login-body">
            {mode === 'login' ? (
              <>
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
              </>
            ) : (
              <p className="login-instruction">New accounts are created as Student / Faculty accounts.</p>
            )}

            <div className="auth-toggle-row">
              <button type="button" className={`auth-toggle ${mode === 'login' ? 'auth-toggle-active' : ''}`} onClick={() => setMode('login')}>
                Login
              </button>
              <button type="button" className={`auth-toggle ${mode === 'register' ? 'auth-toggle-active' : ''}`} onClick={() => { setMode('register'); setSelectedRole(Role.BUYER); }}>
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
          <img
            className="login-illustration-image"
            src={loginIllustration}
            alt="Freshly prepared cafeteria meal"
          />
          <div className="login-illustration-content">
            <Sparkles size={48} />
            <h2>Fresh & Delicious</h2>
            <p>Order your favorite meals from the Palm cafeteria with ease</p>
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
  const paymentReturnHandled = useRef(false);

  useEffect(() => {
    SyncService.getSession().then((sessionUser) => {
      setUser(sessionUser);
      if (sessionUser?.role === Role.SELLER) setActiveTab('inventory');
    }).catch((error) => {
      console.error("Unable to restore session:", error);
    });
  }, []);

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
    setNotifications((prev) => {
      const serverNotifications = Array.isArray(n) ? n : [];
      const userKey = user?.id ? `read_notifications_${user.id}` : "read_notifications";
      let localReadMap = {};
      try {
        localReadMap = JSON.parse(localStorage.getItem(userKey) || "{}");
      } catch {}

      return serverNotifications.map((item) => {
        const readAt = item.read_at || localReadMap[item.id] || (prev?.find(p => p.id === item.id)?.read_at);
        return readAt ? { ...item, read_at: readAt } : item;
      });
    });
  };

  useEffect(() => {
    if (!user || paymentReturnHandled.current) return;

    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") || params.get("trxref");
    const paymentStatus = params.get("payment");
    if (!reference && paymentStatus !== "cancelled") return;

    paymentReturnHandled.current = true;
    window.history.replaceState({}, "", window.location.pathname);
    if (!reference) {
      alert("Checkout was cancelled. No payment was confirmed.");
      return;
    }

    SyncService.verifyPayment(reference)
      .then(async ({ status }) => {
        if (status === "paid") {
          setCart([]);
          await fetchData();
          alert("Payment confirmed. Your order has been recorded.");
        } else if (status === "needs_review") {
          alert("Payment was received, but the order needs staff review. Please contact the cafeteria.");
        } else if (status === "pending") {
          alert("Payment is still processing. Check your orders again shortly.");
        } else if (status === "expired") {
          alert("The order reservation expired before payment was confirmed. Please contact the cafeteria.");
        } else {
          alert("Payment was not completed. No order was recorded.");
        }
      })
      .catch((error) => {
        alert(error.message || "Unable to confirm payment. Your order has not been marked paid.");
      });
  }, [user]);

  useEffect(() => {
    if (activeTab === 'sellers' && user?.role !== Role.ADMIN) {
      setActiveTab('dashboard');
    } else if (activeTab === 'inventory' && ![Role.ADMIN, Role.SELLER].includes(user?.role)) {
      setActiveTab('dashboard');
    }
  }, [activeTab, user]);

  const handleLogin = async (role, email, password) => {
    const userData = await SyncService.login({ email, password, role });
    setUser(userData);
    setActiveTab(
      userData.role === Role.BUYER
        ? 'browse'
        : userData.role === Role.SELLER
          ? 'inventory'
          : 'dashboard'
    );
  };

  const handleRegister = async ({ name, email, password }) => {
    const userData = await SyncService.register({ name, email, password });
    setUser(userData);
    setActiveTab(userData.role === Role.BUYER ? 'browse' : 'dashboard');
  };

  const handleLogout = async () => {
    try {
      await SyncService.logout();
    } catch (error) {
      alert(error.message || "Unable to log out. Please try again.");
      return;
    }
    setUser(null);
    setCart([]);
  };

  const isMealAvailable = (meal) => {
    if (meal.availability_status && meal.availability_status !== "available") return false;
    if (Number(meal.stock) <= 0) return false;
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

  const handleCheckout = async () => {
    if (cart.length === 0) return false;

    setIsProcessingPayment(true);
    try {
      const checkout = await SyncService.initializePayment({ cart });
      const authorizationUrl = new URL(checkout.authorization_url);
      if (
        authorizationUrl.protocol !== "https:" ||
        !["checkout.paystack.com", "paystack.com"].includes(authorizationUrl.hostname)
      ) {
        throw new Error("Payment provider returned an invalid checkout address.");
      }
      window.location.assign(authorizationUrl.toString());
      return false;
    } catch (error) {
      alert(error.message || "Payment failed.");
      return false;
    } finally {
      setIsProcessingPayment(false);
    }
  };

  if (!user) return <AuthView handleLogin={handleLogin} handleRegister={handleRegister} />;

  const unreadNotificationCount = [Role.BUYER, Role.SELLER].includes(user?.role)
    ? notifications.filter((n) => !n.read_at).length
    : 0;

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: [Role.ADMIN, Role.SELLER] },
    { id: 'reports', label: 'Analytics', icon: TrendingUp, roles: [Role.ADMIN, Role.SELLER] },
    { id: 'browse', label: 'Menu', icon: Utensils, roles: [Role.BUYER] },
    { id: 'my-orders', label: 'My Orders', icon: ShoppingCart, roles: [Role.BUYER] },
    { id: 'preorders', label: 'Pre-Orders', icon: Clock, roles: [Role.BUYER] },
    { id: 'inventory', label: user.role === Role.SELLER ? 'Shared Inventory & My Meals' : 'Inventory', icon: Package, roles: [Role.ADMIN, Role.SELLER] },
    { id: 'orders', label: 'Orders', icon: ShoppingCart, roles: [Role.SELLER] },
    { id: 'seller-preorders', label: 'Pre-Orders', icon: Clock, roles: [Role.SELLER] },
    { id: 'sellers', label: 'Sellers', icon: Users, roles: [Role.ADMIN] },
    { id: 'cart', label: 'Cart', icon: ShoppingCart, roles: [Role.BUYER], count: cart.length },
    { id: 'notifications', label: 'Notifications', icon: Bell, roles: [Role.ADMIN, Role.SELLER, Role.BUYER], count: unreadNotificationCount },
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
                <span className="sidebar-logo-title">E<sup>3</sup></span>
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
            
            <IconButton
              icon={Bell}
              variant="ghost"
              badge={unreadNotificationCount || undefined}
              onClick={() => setActiveTab('notifications')}
            />
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
              {activeTab === 'inventory' && [Role.ADMIN, Role.SELLER].includes(user.role) && <InventoryView user={user} fetchData={fetchData} />}
              {activeTab === 'orders' && user.role === Role.SELLER && <OrdersView sales={sales} meals={meals} fetchData={fetchData} />}
              {activeTab === 'seller-preorders' && user.role === Role.SELLER && <SellerPreOrdersView preorders={preorders} meals={meals} fetchData={fetchData} />}
              {activeTab === 'sellers' && user.role === Role.ADMIN && <SellersView />}
              {activeTab === 'browse' && <BrowseView meals={meals} cart={cart} addToCart={addToCart} handlePreOrder={handlePreOrder} isMealAvailable={isMealAvailable} getRemainingTime={getRemainingTime} />}
              {activeTab === 'my-orders' && user.role === Role.BUYER && <BuyerOrdersView />}
              {activeTab === 'preorders' && <PreOrderView meals={meals} handlePreOrder={handlePreOrder} isMealAvailable={isMealAvailable} />}
              {activeTab === 'cart' && <CartView cart={cart} setActiveTab={setActiveTab} removeFromCart={removeFromCart} handleCheckout={handleCheckout} isProcessingPayment={isProcessingPayment} />}
              {activeTab === 'notifications' && (
                <NotificationsView
                  notifications={notifications}
                  setNotifications={setNotifications}
                  fetchData={fetchData}
                  user={user}
                />
              )}
              {activeTab === 'feedback' && <FeedbackView feedbacks={feedbacks} meals={meals} user={user} fetchData={fetchData} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
