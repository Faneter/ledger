import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ThemeProvider,
  CssBaseline,
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  IconButton,
  Button,
  Fab,
  BottomNavigation,
  BottomNavigationAction,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  Chip,
  useMediaQuery,
  Card,
  CardContent,
  Stack,
  Divider,
  Grid,
  DialogActions,
  TextField,
  InputAdornment,
  Switch,
  FormControlLabel,
  Tooltip,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import SpaceDashboardRounded from '@mui/icons-material/SpaceDashboardRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import SavingsRounded from '@mui/icons-material/SavingsRounded';
import ConfirmationNumberRounded from '@mui/icons-material/ConfirmationNumberRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import LightModeRounded from '@mui/icons-material/LightModeRounded';
import DarkModeRounded from '@mui/icons-material/DarkModeRounded';
import CloudDoneRounded from '@mui/icons-material/CloudDoneRounded';
import CloudOffRounded from '@mui/icons-material/CloudOffRounded';
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SyncRounded from '@mui/icons-material/SyncRounded';
import FileDownloadRounded from '@mui/icons-material/FileDownloadRounded';
import FileUploadRounded from '@mui/icons-material/FileUploadRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import CleaningServicesRounded from '@mui/icons-material/CleaningServicesRounded';

import { createMd3Theme } from './theme/md3-theme';
import { LocalLedgerEngine } from './sync/local-replica';
import { QuickInputBar } from './components/QuickInputBar';
import { OverviewPage } from './components/OverviewPage';
import { TransactionsView } from './components/TransactionsView';
import { BudgetPoolsDashboard } from './components/BudgetPoolsDashboard';
import { AccountMatrixPanel } from './components/AccountMatrixPanel';
import { SyncAndConflictModal } from './components/SyncAndConflictModal';

type NavTab = 'overview' | 'transactions' | 'budgets' | 'accounts' | 'settings';

const DRAWER_WIDTH = 250;

export const App: React.FC = () => {
  // 1. 本地存储主题模式 (默认 'light' 呈现清爽 MD3 质感)
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('geek_ledger_theme_mode');
    return saved === 'dark' ? 'dark' : 'light';
  });

  // 2. 当前导航标签
  const [currentTab, setCurrentTab] = useState<NavTab>('overview');

  // 3. 弹窗状态
  const [showQuickRecordModal, setShowQuickRecordModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showResetChoiceModal, setShowResetChoiceModal] = useState(false);

  // 4. 单例本地账本引擎
  const engine = useMemo(() => new LocalLedgerEngine(), []);
  const [, setTick] = useState(0);

  const [fxHoldPctInput, setFxHoldPctInput] = useState(() =>
    String(Number((Number(engine.state.fxConfig?.defaultHoldRatio ?? 1.02) * 100).toFixed(1)))
  );
  const [fxCashbackPctInput, setFxCashbackPctInput] = useState(() =>
    String(Number((Number(engine.state.fxConfig?.defaultCashbackRate ?? 0.01) * 100).toFixed(2)))
  );

  useEffect(() => {
    if (engine.state.fxConfig) {
      setFxHoldPctInput(String(Number((Number(engine.state.fxConfig.defaultHoldRatio) * 100).toFixed(1))));
      setFxCashbackPctInput(String(Number((Number(engine.state.fxConfig.defaultCashbackRate) * 100).toFixed(2))));
    }
  }, [engine.state.fxConfig]);

  // 监听本地账本变动并触发响应式更新
  useEffect(() => {
    const unsubscribe = engine.subscribe(() => {
      setTick((t) => t + 1);
    });
    return unsubscribe;
  }, [engine]);

  // 保持 HTML 根元素 theme 属性同步
  useEffect(() => {
    localStorage.setItem('geek_ledger_theme_mode', themeMode);
    document.documentElement.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  // 构建 MD3 主题
  const theme = useMemo(() => createMd3Theme(themeMode), [themeMode]);
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  const pendingCount = engine.state.pendingSyncOps.length;
  const pendingConflictCount = engine.state.conflicts.filter(
    (c) => c.status === 'PENDING'
  ).length;
  const isOffline = engine.state.isOfflineMode;

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [backupToast, setBackupToast] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'info' | 'warning' | 'error';
  }>({ open: false, message: '', severity: 'info' });

  const syncInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const runSync = useCallback(
    async (showFeedback = false): Promise<{ success: boolean; message?: string }> => {
      if (engine.state.isOfflineMode) {
        return { success: false, message: '当前处于「仅存本地」模式，未向云端同步。' };
      }
      if (syncInFlightRef.current) {
        return { success: false, message: '同步正在进行中，请稍候。' };
      }

      syncInFlightRef.current = true;
      setSyncing(true);
      try {
        const res = await engine.syncWithServer();
        if (res.serverResetDetected) {
          setSyncError(null);
          const msg = '检测到云端账本为空，请确认是否将本机数据恢复至云端。';
          setBackupToast({ open: true, severity: 'warning', message: msg });
          return { success: false, message: msg };
        }
        if (res.success) {
          setSyncError(null);
          const newPendingConflicts = engine.state.conflicts.filter(
            (c) => c.status === 'PENDING'
          ).length;
          if (newPendingConflicts > 0) {
            const msg = `发现 ${newPendingConflicts} 处多端修改差异，请点击同步状态确认。`;
            if (showFeedback) {
              setBackupToast({ open: true, severity: 'warning', message: msg });
            }
            return { success: true, message: msg };
          }
          const msg =
            res.appliedRemoteCount > 0
              ? `云端同步完成，已更新 ${res.appliedRemoteCount} 条记录。`
              : '云端同步已完成，数据已保持最新。';
          if (showFeedback) {
            setBackupToast({ open: true, severity: 'success', message: msg });
          }
          return { success: true, message: msg };
        }

        const errMsg = res.error || '暂未连接到云端服务';
        setSyncError(errMsg);
        if (showFeedback) {
          setBackupToast({
            open: true,
            severity: 'warning',
            message: '暂未连接到云端服务，变更已安全保存于本机。',
          });
        }
        return { success: false, message: '暂未连接到云端服务，变更已安全保存于本机。' };
      } catch {
        setSyncError('暂未连接到云端服务');
        if (showFeedback) {
          setBackupToast({
            open: true,
            severity: 'warning',
            message: '暂未连接到云端服务，变更已安全保存于本机。',
          });
        }
        return { success: false, message: '暂未连接到云端服务，变更已安全保存于本机。' };
      } finally {
        syncInFlightRef.current = false;
        setSyncing(false);
      }
    },
    [engine]
  );

  // 1) 启动时 & 网络恢复时自动静默同步
  useEffect(() => {
    if (!engine.state.isOfflineMode) {
      void runSync(false);
    }
    const handleOnline = () => {
      if (!engine.state.isOfflineMode) {
        void runSync(false);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [engine, runSync]);

  // 2) 数据变更后 1200ms 防抖静默自动同步
  useEffect(() => {
    if (isOffline || engine.serverResetDetected || engine.state.pendingSyncOps.length === 0) return;
    const timer = window.setTimeout(() => {
      void runSync(false);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [engine.stateVersion, isOffline, runSync]);

  const handleOpenSyncStatus = () => {
    setShowSyncModal(true);
    if (!isOffline && pendingConflictCount === 0 && !engine.serverResetDetected && (pendingCount > 0 || syncError)) {
      void runSync(false);
    }
  };

  const syncStatusChip = useMemo(() => {
    if (pendingConflictCount > 0) {
      return {
        label: `${pendingConflictCount} 处同步差异待确认`,
        shortLabel: `${pendingConflictCount} 处差异`,
        color: 'error' as const,
        icon: <WarningAmberRounded fontSize="small" />,
      };
    }
    if (syncing) {
      return {
        label: '同步中...',
        shortLabel: '同步中',
        color: 'info' as const,
        icon: <CircularProgress size={14} color="inherit" />,
      };
    }
    if (isOffline) {
      return {
        label: '仅存本地',
        shortLabel: '仅本地',
        color: 'warning' as const,
        icon: <CloudOffRounded fontSize="small" />,
      };
    }
    if (engine.serverResetDetected) {
      return {
        label: '云端空库待确认',
        shortLabel: '待确认',
        color: 'warning' as const,
        icon: <WarningAmberRounded fontSize="small" />,
      };
    }
    if (pendingCount > 0 || syncError) {
      return {
        label: pendingCount > 0 ? `本地已存 (${pendingCount} 笔待同步)` : '本地已保存',
        shortLabel: pendingCount > 0 ? `待传 ${pendingCount}` : '本地已存',
        color: 'warning' as const,
        icon: <CloudUploadRounded fontSize="small" />,
      };
    }
    return {
      label: '已同步',
      shortLabel: '已同步',
      color: 'success' as const,
      icon: <CloudDoneRounded fontSize="small" />,
    };
  }, [pendingConflictCount, syncing, isOffline, engine.serverResetDetected, pendingCount, syncError]);

  const lastSyncTooltip = engine.state.lastSyncAt
    ? `上次同步：${new Date(engine.state.lastSyncAt).toLocaleString()}（点击查看详情）`
    : '尚未与云端同步（点击查看同步与差异处理）';

  const handleToggleTheme = () => {
    setThemeMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleResetToClean = () => {
    if (
      window.confirm(
        '确定要恢复为【纯净初始账本】吗？\n将重置为 0 优惠券、0 交易流水，仅保留标准的 4 大月度预算池与常用收支分类体系。'
      )
    ) {
      engine.resetToCleanState();
      setShowResetChoiceModal(false);
    }
  };

  const handleLoadDemo = () => {
    if (
      window.confirm(
        '确定要载入【PRD 演示测试数据】吗？\n将加载标准示例预算池、专项预算、测试优惠券与周期扣款规则，方便体验完整功能闭环。'
      )
    ) {
      engine.loadDemoData();
      setShowResetChoiceModal(false);
    }
  };

  const handleExportBackup = () => {
    try {
      const bundle = engine.exportFullSyncBundle();
      const dataStr =
        'data:text/json;charset=utf-8,' +
        encodeURIComponent(JSON.stringify(bundle, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute(
        'download',
        `geek_ledger_backup_${new Date().toISOString().slice(0, 10)}.json`
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setBackupToast({
        open: true,
        severity: 'success',
        message: '已导出完整 JSON 备份文件。',
      });
    } catch (err) {
      setBackupToast({
        open: true,
        severity: 'error',
        message: err instanceof Error ? err.message : '导出备份失败',
      });
    }
  };

  const handleImportBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const hasCoreArray =
        parsed &&
        typeof parsed === 'object' &&
        (Array.isArray(parsed.transactions) ||
          Array.isArray(parsed.budgetPools) ||
          Array.isArray(parsed.vouchers) ||
          Array.isArray(parsed.monthlyBudgets));

      if (!hasCoreArray) {
        setBackupToast({
          open: true,
          severity: 'error',
          message: '所选 JSON 文件不是有效的 GeekLedger 账本备份。',
        });
        return;
      }

      if (
        !window.confirm(
          `确定要导入备份文件「${file.name}」吗？\n导入后将使用备份中的数据替换当前本地账本。`
        )
      ) {
        return;
      }

      const summary = engine.importFullSyncBundle(parsed);
      setBackupToast({
        open: true,
        severity: 'success',
        message: `备份导入成功：已恢复 ${summary.transactionsCount} 笔流水、${summary.poolsCount} 个预算池、${summary.vouchersCount} 张优惠券。`,
      });
      if (!engine.state.isOfflineMode) {
        void runSync(false);
      }
    } catch (err) {
      setBackupToast({
        open: true,
        severity: 'error',
        message:
          err instanceof Error
            ? `导入备份失败：${err.message}`
            : '导入备份失败：请检查 JSON 文件格式是否正确',
      });
    }
  };

  const NAV_ITEMS: { key: NavTab; label: string; icon: React.ReactElement }[] = [
    { key: 'overview', label: '概览', icon: <SpaceDashboardRounded /> },
    { key: 'transactions', label: '账单', icon: <ReceiptLongRounded /> },
    { key: 'budgets', label: '预算与专项', icon: <SavingsRounded /> },
    { key: 'accounts', label: '卡包与周期', icon: <ConfirmationNumberRounded /> },
    { key: 'settings', label: '设置与同步', icon: <TuneRounded /> },
  ];

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
        {/* ================================================================= */}
        {/* 1. 桌面端永久抽屉导航 (Desktop Left Drawer) */}
        {/* ================================================================= */}
        {isDesktop && (
          <Drawer
            variant="permanent"
            sx={{
              width: DRAWER_WIDTH,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: DRAWER_WIDTH,
                boxSizing: 'border-box',
                borderRight: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                p: 2,
              },
            }}
          >
            {/* 抽屉顶部：品牌 Header + 记一笔主操作 */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, px: 1 }}>
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '12px',
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.25rem',
                    boxShadow: '0 4px 12px rgba(11, 87, 208, 0.3)',
                  }}
                >
                  ⚡
                </Box>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                    GeekLedger
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                    MD3 个人预算记账本
                  </Typography>
                </Box>
              </Box>

              {/* 醒目的「+ 记一笔」按钮 */}
              <Button
                variant="contained"
                color="primary"
                fullWidth
                size="large"
                startIcon={<AddRounded />}
                onClick={() => setShowQuickRecordModal(true)}
                sx={{
                  py: 1.2,
                  mb: 2.5,
                  borderRadius: 999,
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  boxShadow: '0 4px 14px rgba(11, 87, 208, 0.25)',
                }}
              >
                + 记一笔
              </Button>

              {/* 5 大核心导航按钮列表 */}
              <List disablePadding>
                {NAV_ITEMS.map((item) => {
                  const isSelected = currentTab === item.key;
                  return (
                    <ListItem key={item.key} disablePadding sx={{ mb: 0.5 }}>
                      <ListItemButton
                        selected={isSelected}
                        onClick={() => setCurrentTab(item.key)}
                        sx={{ py: 1.2, px: 2 }}
                      >
                        <ListItemIcon
                          sx={{
                            minWidth: 40,
                            color: isSelected ? 'primary.main' : 'text.secondary',
                          }}
                        >
                          {item.icon}
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Typography
                              sx={{
                                fontWeight: isSelected ? 700 : 500,
                                fontSize: '0.9rem',
                                color: isSelected ? 'primary.main' : 'text.primary',
                              }}
                            >
                              {item.label}
                            </Typography>
                          }
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
            </Box>

            {/* 抽屉底部状态与操作控制栏 */}
            <Box sx={{ pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              {/* 云同步状态卡片 */}
              <Tooltip title={lastSyncTooltip}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 1,
                    borderRadius: '12px',
                    bgcolor: (t) =>
                      t.palette.mode === 'light' ? '#f5f7fc' : '#141a24',
                    mb: 1.5,
                    cursor: 'pointer',
                  }}
                  onClick={handleOpenSyncStatus}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: `${syncStatusChip.color}.main` }}>
                    {syncStatusChip.icon}
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>
                      {syncStatusChip.shortLabel}
                    </Typography>
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                    详情
                  </Typography>
                </Box>
              </Tooltip>

              {/* 快捷操作条：深浅色切换、数据重置 */}
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <IconButton
                  size="small"
                  onClick={handleToggleTheme}
                  title={themeMode === 'light' ? '切换深色模式' : '切换浅色模式'}
                  sx={{ color: 'text.secondary' }}
                >
                  {themeMode === 'light' ? <DarkModeRounded /> : <LightModeRounded />}
                </IconButton>

                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  onClick={() => setShowResetChoiceModal(true)}
                  startIcon={<RestartAltRounded fontSize="small" />}
                  sx={{ fontSize: '0.75rem', color: 'text.secondary' }}
                >
                  数据重置
                </Button>
              </Stack>
            </Box>
          </Drawer>
        )}

        {/* ================================================================= */}
        {/* 2. 主体工作区 (Main Content Area) */}
        {/* ================================================================= */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            overflowX: 'hidden',
          }}
        >
          {/* 桌面端顶栏 Header */}
          {isDesktop ? (
            <Box
              sx={{
                px: 4,
                py: 2,
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {NAV_ITEMS.find((it) => it.key === currentTab)?.label}
              </Typography>

              <Tooltip title={lastSyncTooltip}>
                <Chip
                  icon={syncStatusChip.icon}
                  label={syncStatusChip.label}
                  color={syncStatusChip.color}
                  variant="outlined"
                  size="small"
                  onClick={handleOpenSyncStatus}
                  sx={{ cursor: 'pointer' }}
                />
              </Tooltip>
            </Box>
          ) : (
            /* 移动端顶栏 AppBar */
            <AppBar
              position="sticky"
              elevation={0}
              sx={{
                bgcolor: 'background.paper',
                color: 'text.primary',
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Toolbar sx={{ justifyContent: 'space-between', px: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: 'primary.main' }}>
                    ⚡
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                    {NAV_ITEMS.find((it) => it.key === currentTab)?.label}
                  </Typography>
                </Box>

                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip
                    icon={syncStatusChip.icon}
                    label={syncStatusChip.shortLabel}
                    color={syncStatusChip.color}
                    variant="outlined"
                    size="small"
                    onClick={handleOpenSyncStatus}
                    sx={{ cursor: 'pointer' }}
                  />

                  <IconButton size="small" onClick={handleToggleTheme}>
                    {themeMode === 'light' ? <DarkModeRounded /> : <LightModeRounded />}
                  </IconButton>
                </Stack>
              </Toolbar>
            </AppBar>
          )}

          {/* 核心页面内容挂载容器 */}
          <Box
            sx={{
              flex: 1,
              p: { xs: 2, sm: 3, md: 4 },
              pb: { xs: 12, md: 4 }, // 移动端预留底栏高度
              maxWidth: 1300,
              width: '100%',
              margin: '0 auto',
            }}
          >
            {/* Tab 1: 概览 */}
            {currentTab === 'overview' && (
              <OverviewPage
                engine={engine}
                onNavigate={(tab) => setCurrentTab(tab as NavTab)}
                onOpenQuickRecord={() => setShowQuickRecordModal(true)}
              />
            )}

            {/* Tab 2: 账单 */}
            {currentTab === 'transactions' && (
              <TransactionsView
                engine={engine}
                onOpenQuickRecord={() => setShowQuickRecordModal(true)}
              />
            )}

            {/* Tab 3: 预算与心愿 */}
            {currentTab === 'budgets' && (
              <BudgetPoolsDashboard engine={engine} />
            )}

            {/* Tab 4: 账户与卡包 */}
            {currentTab === 'accounts' && (
              <AccountMatrixPanel engine={engine} />
            )}

            {/* Tab 5: 设置与同步 */}
            {currentTab === 'settings' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Card>
                  <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                      ⚙️ 偏好设置、云同步与数据备份
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
                      管理云端自动同步、外币记账默认规则与本地数据备份
                    </Typography>

                    <Divider sx={{ mb: 3 }} />

                    <Stack spacing={2.5}>
                      {/* 1. 云端自动同步 */}
                      <Stack spacing={1.5}>
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={2}
                          sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                        >
                          <Box>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                云端同步状态
                              </Typography>
                              <Chip
                                size="small"
                                color={syncStatusChip.color}
                                icon={syncStatusChip.icon}
                                label={syncStatusChip.label}
                              />
                            </Stack>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {pendingConflictCount > 0
                                ? `发现 ${pendingConflictCount} 处多端修改差异，请打开同步详情确认保留哪份内容。`
                                : isOffline
                                ? '已开启「仅在本地保存」，记账数据暂不同步至云端。'
                                : pendingCount > 0
                                ? `本地已安全保存 ${pendingCount} 笔最新变更，将在后台自动同步；` +
                                  (engine.state.lastSyncAt
                                    ? `上次同步：${new Date(engine.state.lastSyncAt).toLocaleString()}`
                                    : '尚未连接过云端')
                                : engine.state.lastSyncAt
                                ? `已于 ${new Date(engine.state.lastSyncAt).toLocaleString()} 完成云端同步`
                                : '已开启后台自动同步，记账变动将静默同步至云端'}
                            </Typography>
                          </Box>

                          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                            <Button
                              variant="contained"
                              color="primary"
                              size="small"
                              startIcon={
                                syncing ? <CircularProgress size={16} color="inherit" /> : <SyncRounded />
                              }
                              disabled={syncing || isOffline}
                              onClick={() => void runSync(true)}
                            >
                              {syncing ? '同步中...' : '立即同步'}
                            </Button>
                            <Button
                              variant="outlined"
                              color={pendingConflictCount > 0 ? 'warning' : 'inherit'}
                              size="small"
                              onClick={() => setShowSyncModal(true)}
                            >
                              {pendingConflictCount > 0 ? `处理差异 (${pendingConflictCount})` : '同步详情'}
                            </Button>
                          </Stack>
                        </Stack>

                        <FormControlLabel
                          control={
                            <Switch
                              checked={isOffline}
                              onChange={(e) => engine.setOfflineMode(e.target.checked)}
                              color="warning"
                            />
                          }
                          label={
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              仅在本地保存（暂停云端同步）
                            </Typography>
                          }
                          sx={{ m: 0 }}
                        />
                      </Stack>

                      <Divider />

                      {/* 3. 外币预授权与返现默认规则 */}
                      <Stack spacing={2}>
                        <Box>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            外币预授权与返现默认规则
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            配置全账本外币交易的默认预授权冻结比例与返现比例，实时应用于记账预估与银行正式清算
                          </Typography>
                        </Box>

                        <Grid container spacing={2}>
                          <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                              label="默认预授权冻结比例 (%)"
                              type="number"
                              fullWidth
                              size="small"
                              value={fxHoldPctInput}
                              onChange={(e) => {
                                setFxHoldPctInput(e.target.value);
                                const val = e.target.value;
                                if (val && !isNaN(Number(val))) {
                                  engine.updateFxConfig({
                                    defaultHoldRatio: (Number(val) / 100).toFixed(3),
                                  });
                                }
                              }}
                              slotProps={{
                                htmlInput: { step: '0.1', min: '100' },
                                input: {
                                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                                },
                              }}
                              helperText="外币记账时默认按此比例预估冻结人民币金额（如 102% 或 100%）"
                            />
                          </Grid>
                          <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                              label="默认外币返现比例 (%)"
                              type="number"
                              fullWidth
                              size="small"
                              value={fxCashbackPctInput}
                              onChange={(e) => {
                                setFxCashbackPctInput(e.target.value);
                                const val = e.target.value;
                                if (val && !isNaN(Number(val))) {
                                  engine.updateFxConfig({
                                    defaultCashbackRate: (Number(val) / 100).toFixed(4),
                                  });
                                }
                              }}
                              slotProps={{
                                htmlInput: { step: '0.01', min: '0' },
                                input: {
                                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                                },
                              }}
                              helperText="外币预授权与正式清算时默认核算的刷卡返现比例（如 1% 或 0%）"
                            />
                          </Grid>
                        </Grid>
                      </Stack>

                      <Divider />

                      {/* 3. 数据备份与恢复 */}
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                      >
                        <Box>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            数据备份与恢复
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            将当前预算池、专项预算、优惠券、周期扣款与账单流水导出为 JSON 备份，或从备份文件完整恢复
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1.5} sx={{ flexShrink: 0, flexWrap: 'wrap' }}>
                          <Button
                            variant="outlined"
                            color="info"
                            startIcon={<FileDownloadRounded />}
                            onClick={handleExportBackup}
                          >
                            导出 JSON 备份
                          </Button>
                          <Button
                            variant="outlined"
                            color="primary"
                            startIcon={<FileUploadRounded />}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            导入 JSON 备份
                          </Button>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json,application/json"
                            style={{ display: 'none' }}
                            onChange={handleImportBackupFile}
                          />
                        </Stack>
                      </Stack>

                      <Divider />

                      {/* 5. 纯净初始化与演示数据恢复 */}
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                          账本数据初始化与演示载入
                        </Typography>

                        <Grid container spacing={2}>
                          {/* 选项 A: 恢复纯净初始账本 */}
                          <Grid size={{ xs: 12, md: 6 }}>
                            <Card variant="outlined" sx={{ p: 2, borderRadius: '16px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                              <Box>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'warning.main' }}>
                                  恢复为纯净初始账本 (推荐新用户)
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, mb: 2 }}>
                                  0 优惠券、0 交易流水，仅保留标准的 4 大月度常规预算池与收支分类体系，从零开始建立个人账本。
                                </Typography>
                              </Box>
                              <Button
                                variant="contained"
                                color="warning"
                                startIcon={<CleaningServicesRounded />}
                                onClick={handleResetToClean}
                              >
                                恢复为纯净初始账本
                              </Button>
                            </Card>
                          </Grid>

                          {/* 选项 B: 加载 PRD 演示测试数据 */}
                          <Grid size={{ xs: 12, md: 6 }}>
                            <Card variant="outlined" sx={{ p: 2, borderRadius: '16px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                              <Box>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                                  加载 PRD 演示测试数据 (体验样例)
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, mb: 2 }}>
                                  载入 PRD 标杆测试样例，包含 4 大预算池、专项预算、测试优惠券、校园网与外币订阅周期扣款规则，快速体验闭环。
                                </Typography>
                              </Box>
                              <Button
                                variant="outlined"
                                color="primary"
                                startIcon={<AutoAwesomeRounded />}
                                onClick={handleLoadDemo}
                              >
                                加载 PRD 演示测试数据
                              </Button>
                            </Card>
                          </Grid>
                        </Grid>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
              </Box>
            )}
          </Box>
        </Box>

        {/* ================================================================= */}
        {/* 3. 移动端浮动操作按钮 (FAB) & 底部导航 (Mobile Bottom Navigation) */}
        {/* ================================================================= */}
        {!isDesktop && (
          <>
            {/* 悬浮 + 记账 FAB 按钮 */}
            <Fab
              color="primary"
              aria-label="add"
              onClick={() => setShowQuickRecordModal(true)}
              sx={{
                position: 'fixed',
                bottom: 76,
                right: 20,
                zIndex: 1100,
              }}
            >
              <AddRounded />
            </Fab>

            {/* 底部固定导航栏 */}
            <Paper
              sx={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 1000,
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
              elevation={3}
            >
              <BottomNavigation
                showLabels
                value={currentTab}
                onChange={(_, newVal: NavTab) => setCurrentTab(newVal)}
                sx={{ bgcolor: 'background.paper' }}
              >
                {NAV_ITEMS.map((item) => (
                  <BottomNavigationAction
                    key={item.key}
                    value={item.key}
                    label={item.label}
                    icon={item.icon}
                  />
                ))}
              </BottomNavigation>
            </Paper>
          </>
        )}

        {/* ================================================================= */}
        {/* 4. 快捷记账全局 MD3 Dialog 弹窗 */}
        {/* ================================================================= */}
        <Dialog
          open={showQuickRecordModal}
          onClose={() => setShowQuickRecordModal(false)}
          maxWidth="md"
          fullWidth
          slotProps={{
            paper: {
              sx: { borderRadius: '24px' },
            },
          }}
        >
          <DialogTitle
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: 700,
              pb: 1,
            }}
          >
            <span>⚡ 记一笔交易</span>
            <IconButton
              size="small"
              onClick={() => setShowQuickRecordModal(false)}
              sx={{ color: 'text.secondary' }}
            >
              <CloseRounded />
            </IconButton>
          </DialogTitle>
          <Divider />
          <DialogContent sx={{ p: { xs: 1.5, sm: 2.5 } }}>
            <QuickInputBar
              engine={engine}
              onSuccess={() => setShowQuickRecordModal(false)}
            />
          </DialogContent>
        </Dialog>

        {/* ================================================================= */}
        {/* 5. 云端同步与差异处理弹窗 */}
        {/* ================================================================= */}
        <SyncAndConflictModal
          engine={engine}
          isOpen={showSyncModal}
          onClose={() => setShowSyncModal(false)}
          syncing={syncing}
          onManualSync={() => runSync(true)}
        />

        {/* 全局操作提示 Snackbar */}
        <Snackbar
          open={backupToast.open}
          autoHideDuration={4000}
          onClose={() => setBackupToast((prev) => ({ ...prev, open: false }))}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            severity={backupToast.severity}
            onClose={() => setBackupToast((prev) => ({ ...prev, open: false }))}
            sx={{ width: '100%' }}
          >
            {backupToast.message}
          </Alert>
        </Snackbar>

        {/* ================================================================= */}
        {/* 6. 数据重置模式选择弹窗 */}
        {/* ================================================================= */}
        <Dialog
          open={showResetChoiceModal}
          onClose={() => setShowResetChoiceModal(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 700 }}>
            选择数据重置方式
          </DialogTitle>
          <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <Card variant="outlined" sx={{ p: 2, borderRadius: '16px' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'warning.main' }}>
                🧹 恢复为纯净初始账本
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', my: 1 }}>
                重置为 0 资产负债、0 优惠券、0 交易流水，仅保留标准的 4 大月度常规预算池与收支分类体系，推荐新用户。
              </Typography>
              <Button
                variant="contained"
                color="warning"
                fullWidth
                size="small"
                startIcon={<CleaningServicesRounded />}
                onClick={handleResetToClean}
              >
                恢复纯净账本 (0 数据)
              </Button>
            </Card>

            <Card variant="outlined" sx={{ p: 2, borderRadius: '16px' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                🚀 加载 PRD 演示测试数据
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', my: 1 }}>
                载入完整演示数据，包含花呗/借记卡初始余额、2 张测试优惠券、校园网与定投周期扣款规则，体验系统闭环。
              </Typography>
              <Button
                variant="outlined"
                color="primary"
                fullWidth
                size="small"
                startIcon={<AutoAwesomeRounded />}
                onClick={handleLoadDemo}
              >
                加载 PRD 演示数据 (体验样例)
              </Button>
            </Card>
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button onClick={() => setShowResetChoiceModal(false)}>取消</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
};
