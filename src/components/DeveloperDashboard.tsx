import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Globe,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
  Briefcase,
  Award,
  Code2,
  Sparkles,
  Mail,
  Cpu,
} from "lucide-react";
import type { AuthUser } from "./AuthGate";

type Props = { user: AuthUser; onExit: () => void; onLogout: () => void };

interface AuthLog {
  id: number;
  user_id: number;
  name: string;
  email: string;
  event: "signup" | "login";
  ip: string;
  created_at: string;
}

interface Stats {
  totalUsers: number;
  activeSessions: number;
  totalSignups: number;
  totalLogins: number;
}

function timeAgo(dateString: string): string {
  const date = new Date(dateString.endsWith("Z") ? dateString : dateString + "Z");
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (isNaN(diffSeconds)) return dateString;
  if (diffSeconds < 5) return "Just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

function formatDateTime(dateString: string): string {
  try {
    const d = new Date(dateString.endsWith("Z") ? dateString : dateString + "Z");
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return dateString;
  }
}

export default function DeveloperDashboard({ user, onExit, onLogout }: Props) {
  const [tab, setTab] = useState<"activity" | "overview" | "users" | "portfolio">("activity");
  const [logs, setLogs] = useState<AuthLog[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    activeSessions: 0,
    totalSignups: 0,
    totalLogins: 0,
  });
  const [recentUsers, setRecentUsers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<"all" | "signup" | "login">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [error, setError] = useState("");

  const fetchData = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const savedToken = localStorage.getItem("siya_token") || "";
      const headers: HeadersInit = savedToken ? { "x-siya-session": savedToken } : {};

      const [logsRes, overviewRes] = await Promise.all([
        fetch("/api/developer/logs?limit=50", { credentials: "include", headers }),
        fetch("/api/developer/overview", { credentials: "include", headers }),
      ]);

      if (!logsRes.ok || !overviewRes.ok) {
        throw new Error("Developer authorization required");
      }

      const logsData = await logsRes.json();
      const overviewData = await overviewRes.json();

      setLogs(logsData.logs || []);
      setStats(
        overviewData.stats || {
          totalUsers: 0,
          activeSessions: 0,
          totalSignups: 0,
          totalLogins: 0,
        }
      );
      setRecentUsers(overviewData.recentUsers || []);
      if (overviewData.allUsers) {
        setAllUsers(overviewData.allUsers);
      }
      setLastUpdated(new Date());
      setError("");
    } catch (err: any) {
      setError(err.message || "Failed to fetch developer data");
    } finally {
      setLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  }, []);

  const loadAllUsers = useCallback(async () => {
    try {
      const savedToken = localStorage.getItem("siya_token") || "";
      const headers: HeadersInit = savedToken ? { "x-siya-session": savedToken } : {};
      const res = await fetch("/api/developer/users", { credentials: "include", headers });
      if (res.ok) {
        const data = await res.json();
        setAllUsers(data.users || []);
      }
    } catch (e) {
      console.error("Failed to load users", e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
    loadAllUsers();
  }, [fetchData, loadAllUsers]);

  // Tab change handler
  useEffect(() => {
    if (tab === "users") {
      loadAllUsers();
    }
  }, [tab, loadAllUsers]);

  // Live auto-polling every 3.5 seconds for real-time activity updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 3500);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const matchesFilter = filterType === "all" || log.event === filterType;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        log.name.toLowerCase().includes(q) ||
        log.email.toLowerCase().includes(q) ||
        (log.ip && log.ip.toLowerCase().includes(q));
      return matchesFilter && matchesSearch;
    });
  }, [logs, filterType, searchQuery]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return allUsers;
    return allUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    );
  }, [allUsers, searchQuery]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  };

  if (error) {
    return (
      <div id="dev-error-screen" className="min-h-[100dvh] bg-[#050507] text-white grid place-items-center p-6">
        <div className="text-center max-w-md">
          <ShieldCheck className="mx-auto mb-4 text-rose-400" size={48} />
          <h1 className="text-2xl font-semibold">Developer Access Denied</h1>
          <p className="text-white/45 mt-2">
            Your account ({user.email}) is not authorized for developer monitoring console.
          </p>
          <button
            id="dev-error-back-btn"
            onClick={onExit}
            className="mt-6 px-6 py-3 rounded-2xl bg-white text-black font-medium hover:bg-white/90 transition-colors cursor-pointer"
          >
            Back to Siya
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="developer-dashboard" className="min-h-[100dvh] bg-[#050507] text-white relative overflow-x-hidden p-4 md:p-8">
      {/* Background Ambience */}
      <div className="absolute -top-48 right-0 w-[500px] h-[500px] bg-violet-600/10 blur-[140px] rounded-full pointer-events-none" />
      <div className="absolute top-1/2 left-[-150px] w-[400px] h-[400px] bg-emerald-600/10 blur-[130px] rounded-full pointer-events-none" />

      {/* Header */}
      <header id="dev-header" className="relative flex flex-col md:flex-row md:items-center justify-between max-w-7xl mx-auto mb-8 gap-4 border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold tracking-wide">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              LIVE MONITORING
            </span>
            <span className="text-xs text-white/40">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold mt-2 tracking-tight">
            Developer Activity Console
          </h1>
          <p className="text-white/40 text-sm mt-1">
            Real-time feed for all logins and signups · Logged in as <span className="text-violet-300">{user.email}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="dev-refresh-btn"
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh feed"
          >
            <RefreshCw size={16} className={isRefreshing ? "animate-spin text-emerald-400" : "text-white/70"} />
            <span>Refresh</span>
          </button>
          <button
            id="dev-back-btn"
            onClick={onExit}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Back to Assistant</span>
          </button>
          <button
            id="dev-logout-btn"
            onClick={logout}
            className="p-2.5 rounded-2xl border border-white/10 bg-white/5 hover:bg-rose-500/15 hover:text-rose-400 transition-colors cursor-pointer"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="relative max-w-7xl mx-auto space-y-6">
        {/* KPI Stat Cards */}
        <div id="dev-kpi-grid" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-3xl border border-white/10 bg-white/[.03] p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between text-white/40 text-xs font-medium uppercase tracking-wider">
              <span>Total Signups</span>
              <UserPlus size={18} className="text-emerald-400" />
            </div>
            <div className="text-3xl font-bold mt-2 text-white">{stats.totalSignups}</div>
            <div className="text-xs text-emerald-400/80 mt-1">Recorded accounts</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[.03] p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between text-white/40 text-xs font-medium uppercase tracking-wider">
              <span>Total Logins</span>
              <LogIn size={18} className="text-sky-400" />
            </div>
            <div className="text-3xl font-bold mt-2 text-white">{stats.totalLogins}</div>
            <div className="text-xs text-sky-400/80 mt-1">Total sign-in events</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[.03] p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between text-white/40 text-xs font-medium uppercase tracking-wider">
              <span>Registered Users</span>
              <Users size={18} className="text-violet-400" />
            </div>
            <div className="text-3xl font-bold mt-2 text-white">{stats.totalUsers}</div>
            <div className="text-xs text-violet-400/80 mt-1">In database</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[.03] p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between text-white/40 text-xs font-medium uppercase tracking-wider">
              <span>Active Sessions</span>
              <Activity size={18} className="text-amber-400" />
            </div>
            <div className="text-3xl font-bold mt-2 text-white">{stats.activeSessions}</div>
            <div className="text-xs text-amber-400/80 mt-1">Valid tokens now</div>
          </div>
        </div>

        {/* Tab Controls & Search Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div id="dev-tab-group" className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/[.06] border border-white/10 w-fit">
            <button
              id="dev-tab-activity"
              onClick={() => setTab("activity")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                tab === "activity"
                  ? "bg-white text-black shadow-lg"
                  : "text-white/60 hover:text-white"
              }`}
            >
              Activity Feed ({logs.length})
            </button>
            <button
              id="dev-tab-overview"
              onClick={() => setTab("overview")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                tab === "overview"
                  ? "bg-white text-black shadow-lg"
                  : "text-white/60 hover:text-white"
              }`}
            >
              Overview
            </button>
            <button
              id="dev-tab-users"
              onClick={() => {
                setTab("users");
                loadAllUsers();
              }}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                tab === "users"
                  ? "bg-white text-black shadow-lg"
                  : "text-white/60 hover:text-white"
              }`}
            >
              All Users ({stats.totalUsers})
            </button>
          </div>

          {/* Search box */}
          <div className="relative w-full sm:w-72">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              id="dev-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, email..."
              className="w-full h-10 pl-9 pr-4 rounded-xl bg-white/[.05] border border-white/10 text-sm outline-none focus:border-violet-400/60 placeholder:text-white/30"
            />
          </div>
        </div>

        {/* TAB 1: Real-time Activity Feed */}
        {tab === "activity" && (
          <div id="dev-activity-panel" className="space-y-4">
            {/* Filter pills */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/40 uppercase tracking-wider font-semibold mr-1">Filter:</span>
              <button
                id="filter-all-btn"
                onClick={() => setFilterType("all")}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                  filterType === "all"
                    ? "bg-white/20 text-white border border-white/30"
                    : "bg-white/5 text-white/50 border border-white/10 hover:text-white"
                }`}
              >
                All Events
              </button>
              <button
                id="filter-signup-btn"
                onClick={() => setFilterType("signup")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                  filterType === "signup"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-white/5 text-white/50 border border-white/10 hover:text-white"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Signups only
              </button>
              <button
                id="filter-login-btn"
                onClick={() => setFilterType("login")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                  filterType === "login"
                    ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                    : "bg-white/5 text-white/50 border border-white/10 hover:text-white"
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                Logins only
              </button>
            </div>

            {/* Activity Stream Container */}
            <div className="rounded-3xl border border-white/10 bg-white/[.03] backdrop-blur-xl overflow-hidden divide-y divide-white/5">
              <div className="p-5 flex items-center justify-between bg-white/[.02]">
                <div className="flex items-center gap-2">
                  <Activity size={18} className="text-violet-400" />
                  <h2 className="font-semibold text-base">Live Activity Log</h2>
                </div>
                <span className="text-xs text-white/40">
                  Showing {filteredLogs.length} events
                </span>
              </div>

              {loading ? (
                <div className="p-12 text-center text-white/40 text-sm">
                  Loading activity stream…
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="p-12 text-center text-white/40 text-sm">
                  No activity found matching your criteria.
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {filteredLogs.map((log) => {
                    const isSignup = log.event === "signup";
                    return (
                      <motion.div
                        id={`auth-log-${log.id}`}
                        key={log.id}
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-white/[.02] transition-colors"
                      >
                        <div className="flex items-start md:items-center gap-3.5">
                          <div
                            className={`w-10 h-10 rounded-2xl grid place-items-center shrink-0 ${
                              isSignup
                                ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
                                : "bg-sky-500/15 border border-sky-500/30 text-sky-400"
                            }`}
                          >
                            {isSignup ? <UserPlus size={18} /> : <LogIn size={18} />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-white">{log.name}</span>
                              <span
                                className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                  isSignup
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                    : "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                                }`}
                              >
                                {isSignup ? "New Account Created" : "User Logged In"}
                              </span>
                            </div>
                            <div className="text-sm text-white/50 flex items-center gap-3 mt-0.5">
                              <span>{log.email}</span>
                              {log.ip && (
                                <span className="flex items-center gap-1 text-xs text-white/35">
                                  <Globe size={11} /> {log.ip}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-white/40 self-end md:self-auto">
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {formatDateTime(log.created_at)}
                          </span>
                          <span className="px-2.5 py-1 rounded-full bg-white/5 text-white/60 font-medium">
                            {timeAgo(log.created_at)}
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: Overview & Recent Accounts */}
        {tab === "overview" && (
          <div id="dev-overview-panel" className="space-y-6">
            <section className="rounded-3xl border border-white/10 bg-white/[.03] overflow-hidden backdrop-blur-xl">
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserRound size={18} className="text-violet-400" />
                  <h2 className="text-lg font-semibold">Recently Registered Accounts</h2>
                </div>
                <span className="text-xs text-white/40">Latest 12 users</span>
              </div>
              <div className="divide-y divide-white/5">
                {recentUsers.map((u: any) => (
                  <div
                    key={u.id}
                    className="px-6 py-4 flex items-center justify-between hover:bg-white/[.02] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-white/10 grid place-items-center text-violet-300">
                        <UserRound size={18} />
                      </div>
                      <div>
                        <div className="font-medium text-white">{u.name}</div>
                        <div className="text-xs text-white/40">{u.email}</div>
                      </div>
                    </div>
                    <div className="text-xs text-white/40 text-right">
                      <div>Joined {formatDateTime(u.created_at)}</div>
                      <div className="text-white/30 text-[11px] mt-0.5">
                        {u.last_login_at
                          ? `Last active: ${timeAgo(u.last_login_at)}`
                          : "Never logged in"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* TAB 3: All Users Directory */}
        {tab === "users" && (
          <section id="dev-users-panel" className="rounded-3xl border border-white/10 bg-white/[.03] overflow-hidden backdrop-blur-xl">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">All Registered Users Directory</h2>
                <p className="text-xs text-white/40 mt-0.5">
                  Complete list of users stored in database
                </p>
              </div>
              <span className="text-xs text-white/40 font-medium">
                {filteredUsers.length} total accounts
              </span>
            </div>

            <div className="divide-y divide-white/5">
              {filteredUsers.length === 0 ? (
                <div className="p-8 text-center text-white/40 text-sm">
                  No users found matching query.
                </div>
              ) : (
                filteredUsers.map((u: any) => (
                  <div
                    key={u.id}
                    className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-3 items-center hover:bg-white/[.02] transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-violet-500/20 text-violet-300 grid place-items-center text-xs font-bold">
                        {u.name.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="font-medium text-sm">{u.name}</span>
                    </div>
                    <span className="text-white/50 text-sm">{u.email}</span>
                    <div className="text-xs text-white/40 md:text-right">
                      <span>Joined {formatDateTime(u.created_at)}</span>
                      {u.last_login_at && (
                        <span className="block text-emerald-400/70 text-[11px]">
                          Last login: {timeAgo(u.last_login_at)}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
