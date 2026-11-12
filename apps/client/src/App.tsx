import React, { useState, useEffect, useMemo } from 'react';
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
  Badge,
  useMediaQuery,
  Card,
  CardContent,
  Stack,
  Divider,
  Grid,
  DialogActions,
} from '@mui/material';
import SpaceDashboardRounded from '@mui/icons-material/SpaceDashboardRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import SavingsRounded from '@mui/icons-material/SavingsRounded';
import AccountBalanceWalletRounded from '@mui/icons-material/AccountBalanceWalletRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import LightModeRounded from '@mui/icons-material/LightModeRounded';
import DarkModeRounded from '@mui/icons-material/DarkModeRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import CloudDoneRounded from '@mui/icons-material/CloudDoneRounded';
import CloudOffRounded from '@mui/icons-material/CloudOffRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SyncRounded from '@mui/icons-material/SyncRounded';
import FileDownloadRounded from '@mui/icons-material/FileDownloadRounded';
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

  const handleToggleTheme = () => {
    setThemeMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const handleResetToClean = () => {
    if (
      window.confirm(
        '确定要恢复为【纯净初始账本】吗？\n将重置为 0 资产负债、0 优惠券、0 交易流水，仅保留标准的 4 大月度预算池与常用收支分类体系。'
      )
    ) {
      engine.resetToCleanState();
      setShowResetChoiceModal(false);
    }
  };

  const handleLoadDemo = () => {
    if (
      window.confirm(
        '确定要载入【PRD 演示测试数据】吗？\n将加载标准示例账户余额、2 张立减金卡券与周期扣款规则，方便体验完整功能闭环。'
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
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const NAV_ITEMS: { key: NavTab; label: string; icon: React.ReactElement }[] = [
    { key: 'overview', label: '概览', icon: <SpaceDashboardRounded /> },
    { key: 'transactions', label: '账单', icon: <ReceiptLongRounded /> },
    { key: 'budgets', label: '预算与心愿', icon: <SavingsRounded /> },
    { key: 'accounts', label: '账户与卡包', icon: <AccountBalanceWalletRounded /> },
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
                    MD3 个人分布式账本
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
              {/* 在线/离线网络状态 */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  p: 1,
                  borderRadius: 2,
                  bgcolor: (t) =>
                    t.palette.mode === 'light' ? '#f5f7fc' : '#141a24',
                  mb: 1.5,
                  cursor: 'pointer',
                }}
                onClick={() => engine.setOfflineMode(!isOffline)}
                title="点击切换离线/在线状态"
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {isOffline ? (
                    <CloudOffRounded fontSize="small" color="warning" />
                  ) : (
                    <CloudDoneRounded fontSize="small" color="success" />
                  )}
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {isOffline ? '离线无网模式' : '在线同步就绪'}
                  </Typography>
                </Box>
                {pendingCount > 0 && (
                  <Chip
                    size="small"
                    label={`待传 ${pendingCount}`}
                    color="warning"
                    sx={{ height: 20, fontSize: '0.65rem' }}
                  />
                )}
              </Box>

              {/* 快捷操作条：深浅色切换、协同中心、重置种子 */}
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <IconButton
                  size="small"
                  onClick={handleToggleTheme}
                  title={themeMode === 'light' ? '切换深色模式' : '切换浅色模式'}
                  sx={{ color: 'text.secondary' }}
                >
                  {themeMode === 'light' ? <DarkModeRounded /> : <LightModeRounded />}
                </IconButton>

                <IconButton
                  size="small"
                  color={pendingConflictCount > 0 ? 'error' : 'primary'}
                  onClick={() => setShowSyncModal(true)}
                  title="多端分布式协同演练中心"
                >
                  <Badge badgeContent={pendingConflictCount} color="error">
                    <ShieldRounded />
                  </Badge>
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

              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Chip
                  icon={isOffline ? <CloudOffRounded /> : <CloudDoneRounded />}
                  label={isOffline ? '离线模式' : '在线同步中'}
                  color={isOffline ? 'warning' : 'success'}
                  variant="outlined"
                  size="small"
                  onClick={() => engine.setOfflineMode(!isOffline)}
                  sx={{ cursor: 'pointer' }}
                />

                <Button
                  variant="outlined"
                  size="small"
                  color={pendingConflictCount > 0 ? 'error' : 'secondary'}
                  startIcon={<ShieldRounded />}
                  onClick={() => setShowSyncModal(true)}
                  sx={{ borderRadius: 999 }}
                >
                  分布式防炸机中心
                  {pendingConflictCount > 0 && ` (${pendingConflictCount})`}
                </Button>
              </Stack>
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

                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <IconButton size="small" onClick={handleToggleTheme}>
                    {themeMode === 'light' ? <DarkModeRounded /> : <LightModeRounded />}
                  </IconButton>

                  <IconButton
                    size="small"
                    color={pendingConflictCount > 0 ? 'error' : 'primary'}
                    onClick={() => setShowSyncModal(true)}
                  >
                    <Badge badgeContent={pendingConflictCount} color="error">
                      <ShieldRounded />
                    </Badge>
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
                <Card sx={{ borderRadius: 3 }}>
                  <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                      ⚙️ 系统设置与多端协同中心
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
                      基于混合逻辑时钟 (HLC) 与 OpLogs 增量日志的本地优先离线账本引擎
                    </Typography>

                    <Divider sx={{ mb: 3 }} />

                    <Stack spacing={2.5}>
                      {/* 1. 分布式多端同步与防炸机中心 */}
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                      >
                        <Box>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            分布式协同与防炸机中心
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            当前本地待同步 OpLogs: {pendingCount} 条 · 未决并发冲突:{' '}
                            {pendingConflictCount} 项
                          </Typography>
                        </Box>
                        <Button
                          variant="contained"
                          color="primary"
                          startIcon={<ShieldRounded />}
                          onClick={() => setShowSyncModal(true)}
                        >
                          分布式协同与防炸机中心
                        </Button>
                      </Stack>

                      <Divider />

                      {/* 2. 网络离线切换 */}
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                      >
                        <Box>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            本地网络连接状态
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {isOffline
                              ? '当前处于纯前端离线脱网模式，所有变动暂存于 IndexedDB / LocalStorage'
                              : '当前处于在线模式，自动保持后台同步心跳'}
                          </Typography>
                        </Box>
                        <Button
                          variant="outlined"
                          color={isOffline ? 'warning' : 'primary'}
                          onClick={() => engine.setOfflineMode(!isOffline)}
                        >
                          {isOffline ? '切换至在线模式' : '模拟断网离线'}
                        </Button>
                      </Stack>

                      <Divider />

                      {/* 3. 完整 JSON 数据备份与导出 */}
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={2}
                        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
                      >
                        <Box>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            数据导出与灾备备份
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            将当前账户、OpLogs 日志、优惠券及月度预算打包导出为标准 JSON 格式文件
                          </Typography>
                        </Box>
                        <Button
                          variant="outlined"
                          color="info"
                          startIcon={<FileDownloadRounded />}
                          onClick={handleExportBackup}
                        >
                          导出完整 JSON 备份
                        </Button>
                      </Stack>

                      <Divider />

                      {/* 4. 纯净初始化与演示数据恢复 */}
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                          账本数据初始化与演示载入
                        </Typography>

                        <Grid container spacing={2}>
                          {/* 选项 A: 恢复纯净初始账本 */}
                          <Grid size={{ xs: 12, md: 6 }}>
                            <Card variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                              <Box>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'warning.main' }}>
                                  恢复为纯净初始账本 (推荐新用户)
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, mb: 2 }}>
                                  0 资产负债、0 优惠券、0 交易流水，仅保留标准的 4 大月度常规预算池与收支分类体系，从零开始建立个人账本。
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
                            <Card variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                              <Box>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'primary.main' }}>
                                  加载 PRD 演示测试数据 (体验样例)
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, mb: 2 }}>
                                  载入 PRD 标杆测试样例，包含花呗/储蓄卡/外币卡初始余额、2 张测试优惠券、校园网与定投周期扣款规则，快速体验闭环。
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
        {/* 5. 分布式多端同步与防炸机演练中心弹窗 */}
        {/* ================================================================= */}
        <SyncAndConflictModal
          engine={engine}
          isOpen={showSyncModal}
          onClose={() => setShowSyncModal(false)}
        />

        {/* ================================================================= */}
        {/* 6. 数据重置模式选择弹窗 */}
        {/* ================================================================= */}
        <Dialog
          open={showResetChoiceModal}
          onClose={() => setShowResetChoiceModal(false)}
          maxWidth="xs"
          fullWidth
          slotProps={{ paper: { sx: { borderRadius: 3 } } }}
        >
          <DialogTitle sx={{ fontWeight: 700 }}>
            选择数据重置方式
          </DialogTitle>
          <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <Card variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
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

            <Card variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
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
