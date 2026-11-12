import React, { useState, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Tabs,
  Tab,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  LinearProgress,
  Grid,
  Stack,
  Alert,
  Snackbar,
  Divider,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import SavingsRounded from '@mui/icons-material/SavingsRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import CategoryRounded from '@mui/icons-material/CategoryRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import StarsRounded from '@mui/icons-material/StarsRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';

import {
  Category,
  MonthlyBudgetStatusRow,
  PoolType,
  ProjectTag,
  RolloverStrategy,
  TagType,
  toDecimal,
  formatCny,
} from '@ledger/core';
import { LocalLedgerEngine, DailyBudgetSummary } from '../sync/local-replica';

export interface BudgetPoolsDashboardProps {
  engine: LocalLedgerEngine;
  currentYearMonth?: string;
  currentDate?: string;
  onRefresh?: () => void;
}

export const BudgetPoolsDashboard: React.FC<BudgetPoolsDashboardProps> = ({
  engine,
  currentYearMonth = '2026-11',
  currentDate = '2026-11-12',
  onRefresh,
}) => {
  // 1. 标签页控制 (0: 月度预算资金池, 1: 专项储蓄与心愿单, 2: 收支分类管理)
  const [activeTab, setActiveTab] = useState(0);

  // 2. 年月选择器状态
  const [yearMonth, setYearMonth] = useState(currentYearMonth);

  // 3. 全局反馈提示 Toast
  const [toast, setToast] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info' | 'warning';
  }>({
    open: false,
    message: '',
    severity: 'info',
  });

  const showToast = (
    message: string,
    severity: 'success' | 'error' | 'info' | 'warning' = 'info'
  ) => {
    setToast({ open: true, message, severity });
  };

  // 4. 数据获取
  const budgetStatuses: MonthlyBudgetStatusRow[] = engine.getMonthlyBudgetStatus(yearMonth);
  const dailySummary: DailyBudgetSummary = engine.getDailyBudgetSummary(yearMonth, currentDate);

  // 资金池定义映射
  const poolDefMap = useMemo(() => {
    return new Map(engine.state.budgetPools.map((p) => [p.id, p]));
  }, [engine.state.budgetPools]);

  // 过滤只展示属于月度预算的资金池 (is_monthly_budget === true)
  const monthlyPoolStatuses = useMemo(() => {
    return budgetStatuses.filter((bs) => {
      const def = poolDefMap.get(bs.pool_id);
      return def ? def.is_monthly_budget : ['POOL_FIXED', 'POOL_DAILY', 'POOL_FLEX', 'POOL_EMERGENCY'].includes(bs.pool_id);
    });
  }, [budgetStatuses, poolDefMap]);

  // 计算常规月度资金池整体水位
  const totalMonthlyBudget = monthlyPoolStatuses.reduce(
    (acc, cur) => acc + Number(cur.total_available_budget),
    0
  );
  const totalMonthlySpent = monthlyPoolStatuses.reduce(
    (acc, cur) => acc + Number(cur.spent_net),
    0
  );
  const totalMonthlyRemaining = monthlyPoolStatuses.reduce(
    (acc, cur) => acc + Number(cur.remaining_budget),
    0
  );
  const overallUsagePercent =
    totalMonthlyBudget > 0
      ? Math.min(100, Math.round((totalMonthlySpent / totalMonthlyBudget) * 100))
      : 0;

  // 专项基金池 (POOL_FUND)
  const fundStatus = budgetStatuses.find((p) => p.pool_id === 'POOL_FUND');
  const fundDef = poolDefMap.get('POOL_FUND');

  // ===========================================================================
  // 弹窗状态与表单模型
  // ===========================================================================

  // 资金池编辑/创建弹窗
  const [poolModalOpen, setPoolModalOpen] = useState(false);
  const [poolEditingId, setPoolEditingId] = useState<string | null>(null);
  const [poolForm, setPoolForm] = useState<{
    id: string;
    name: string;
    pool_type: PoolType;
    rollover_strategy: RolloverStrategy;
    description: string;
    base_allocation: string;
    is_monthly_budget: boolean;
  }>({
    id: '',
    name: '',
    pool_type: 'FLEX',
    rollover_strategy: 'RESET',
    description: '',
    base_allocation: '500.00',
    is_monthly_budget: true,
  });

  // 心愿单编辑/创建弹窗
  const [wishModalOpen, setWishModalOpen] = useState(false);
  const [wishEditingId, setWishEditingId] = useState<string | null>(null);
  const [wishForm, setWishForm] = useState<{
    id: string;
    name: string;
    target_budget: string;
    tag_type: TagType;
    start_date: string;
    end_date: string;
    linked_pool_id: string;
    is_active: boolean;
  }>({
    id: '',
    name: '',
    target_budget: '500.00',
    tag_type: 'PROJECT',
    start_date: '2026-11-01',
    end_date: '2026-12-31',
    linked_pool_id: 'POOL_FUND',
    is_active: true,
  });

  // 分类编辑/创建弹窗
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catEditingId, setCatEditingId] = useState<string | null>(null);
  const [catForm, setCatForm] = useState<{
    id: string;
    name: string;
    default_pool_id: string;
    icon_name: string;
    keywords: string;
  }>({
    id: '',
    name: '',
    default_pool_id: 'POOL_DAILY',
    icon_name: '🏷️',
    keywords: '',
  });

  // ===========================================================================
  // Tab 0: 月度预算资金池处理逻辑
  // ===========================================================================

  const handleOpenAddPool = () => {
    setPoolEditingId(null);
    setPoolForm({
      id: `POOL_CUSTOM_${Date.now()}`,
      name: '',
      pool_type: 'FLEX',
      rollover_strategy: 'RESET',
      description: '',
      base_allocation: '300.00',
      is_monthly_budget: true,
    });
    setPoolModalOpen(true);
  };

  const handleOpenEditPool = (poolRow: MonthlyBudgetStatusRow) => {
    const def = poolDefMap.get(poolRow.pool_id);
    setPoolEditingId(poolRow.pool_id);
    setPoolForm({
      id: poolRow.pool_id,
      name: poolRow.pool_name,
      pool_type: poolRow.pool_type,
      rollover_strategy: def?.rollover_strategy || 'RESET',
      description: def?.description || '',
      base_allocation: poolRow.base_allocation,
      is_monthly_budget: def?.is_monthly_budget ?? true,
    });
    setPoolModalOpen(true);
  };

  const handleSavePool = () => {
    if (!poolForm.name.trim()) {
      showToast('请输入资金池名称', 'warning');
      return;
    }
    if (isNaN(Number(poolForm.base_allocation)) || Number(poolForm.base_allocation) < 0) {
      showToast('请输入有效的本月基准预算额度', 'warning');
      return;
    }

    try {
      if (poolEditingId) {
        // 更新资金池属性与当月预算
        engine.upsertBudgetPool({
          id: poolEditingId,
          name: poolForm.name.trim(),
          description: poolForm.description.trim() || null,
          rollover_strategy: poolForm.rollover_strategy,
        });
        engine.upsertMonthlyBudget({
          year_month: yearMonth,
          pool_id: poolEditingId,
          base_allocation: poolForm.base_allocation,
        });
        showToast(`资金池【${poolForm.name}】及 ${yearMonth} 预算更新成功`, 'success');
      } else {
        // 新建资金池并配置初始额度
        const newPool = engine.upsertBudgetPool({
          id: poolForm.id,
          name: poolForm.name.trim(),
          pool_type: poolForm.pool_type,
          is_monthly_budget: true,
          rollover_strategy: poolForm.rollover_strategy,
          description: poolForm.description.trim() || null,
        });
        engine.upsertMonthlyBudget({
          year_month: yearMonth,
          pool_id: newPool.id,
          base_allocation: poolForm.base_allocation,
        });
        showToast(`新增月度资金池【${newPool.name}】成功`, 'success');
      }
      setPoolModalOpen(false);
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleDeletePool = (poolId: string, poolName: string) => {
    if (!window.confirm(`确定要删除资金池【${poolName}】吗？`)) return;
    try {
      engine.deleteBudgetPool(poolId);
      showToast(`资金池【${poolName}】已删除`, 'success');
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleSweepDailyToFund = () => {
    try {
      const res = engine.sweepDailyToFund(yearMonth);
      showToast(
        `✨ 结余划转成功！高频池结余 ¥${res.sweptAmount} 已划入年度专项基金池`,
        'success'
      );
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // ===========================================================================
  // Tab 1: 专项储蓄与心愿单处理逻辑
  // ===========================================================================

  const handleOpenAddWish = (initialName?: string, initialBudget?: string) => {
    setWishEditingId(null);
    setWishForm({
      id: `TAG_${Date.now()}`,
      name: initialName || '',
      target_budget: initialBudget || '500.00',
      tag_type: 'PROJECT',
      start_date: `${yearMonth}-01`,
      end_date: `${yearMonth}-30`,
      linked_pool_id: 'POOL_FUND',
      is_active: true,
    });
    setWishModalOpen(true);
  };

  const handleOpenEditWish = (tag: ProjectTag) => {
    setWishEditingId(tag.id);
    setWishForm({
      id: tag.id,
      name: tag.name,
      target_budget: tag.target_budget || '0.00',
      tag_type: tag.tag_type,
      start_date: tag.start_date || '',
      end_date: tag.end_date || '',
      linked_pool_id: tag.linked_pool_id || 'POOL_FUND',
      is_active: tag.is_active,
    });
    setWishModalOpen(true);
  };

  const handleSaveWish = () => {
    if (!wishForm.name.trim()) {
      showToast('请输入心愿/专项名称', 'warning');
      return;
    }
    try {
      engine.upsertProjectTag({
        id: wishEditingId || wishForm.id,
        name: wishForm.name.trim(),
        target_budget: wishForm.target_budget,
        tag_type: wishForm.tag_type,
        start_date: wishForm.start_date || null,
        end_date: wishForm.end_date || null,
        linked_pool_id: wishForm.linked_pool_id || null,
        is_active: wishForm.is_active,
      });
      showToast(
        wishEditingId
          ? `心愿专项【${wishForm.name}】已更新`
          : `已新增心愿专项【${wishForm.name}】`,
        'success'
      );
      setWishModalOpen(false);
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleDeleteWish = (tagId: string, tagName: string) => {
    if (!window.confirm(`确定要删除心愿专项【${tagName}】吗？`)) return;
    try {
      engine.deleteProjectTag(tagId);
      showToast(`心愿专项【${tagName}】已删除`, 'success');
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // ===========================================================================
  // Tab 2: 收支分类管理处理逻辑
  // ===========================================================================

  const handleOpenAddCategory = () => {
    setCatEditingId(null);
    setCatForm({
      id: `CAT_CUSTOM_${Date.now()}`,
      name: '',
      default_pool_id: 'POOL_DAILY',
      icon_name: '🏷️',
      keywords: '',
    });
    setCatModalOpen(true);
  };

  const handleOpenEditCategory = (cat: Category) => {
    setCatEditingId(cat.id);
    setCatForm({
      id: cat.id,
      name: cat.name,
      default_pool_id: cat.default_pool_id,
      icon_name: cat.icon_name || '🏷️',
      keywords: cat.keywords || '',
    });
    setCatModalOpen(true);
  };

  const handleSaveCategory = () => {
    if (!catForm.name.trim()) {
      showToast('请输入分类名称', 'warning');
      return;
    }
    try {
      engine.upsertCategory({
        id: catEditingId || catForm.id,
        name: catForm.name.trim(),
        default_pool_id: catForm.default_pool_id,
        icon_name: catForm.icon_name.trim() || '🏷️',
        keywords: catForm.keywords.trim() || null,
      });
      showToast(
        catEditingId
          ? `分类【${catForm.name}】已更新`
          : `已新增收支分类【${catForm.name}】`,
        'success'
      );
      setCatModalOpen(false);
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleDeleteCategory = (catId: string, catName: string) => {
    if (!window.confirm(`确定要删除分类【${catName}】吗？`)) return;
    try {
      engine.deleteCategory(catId);
      showToast(`分类【${catName}】已删除`, 'success');
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // ===========================================================================
  // 辅助渲染方法
  // ===========================================================================

  const getRolloverChip = (strategy?: RolloverStrategy) => {
    switch (strategy) {
      case 'SWEEP_TO_FUND':
        return <Chip size="small" color="info" label="结余划转 (SWEEP)" variant="outlined" />;
      case 'RESET':
        return <Chip size="small" color="default" label="月末清零 (RESET)" variant="outlined" />;
      case 'ACCUMULATE':
        return <Chip size="small" color="secondary" label="全额滚存 (ACCUMULATE)" variant="outlined" />;
      default:
        return <Chip size="small" label="常规池" variant="outlined" />;
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* 顶部主选项卡切换 */}
      <Card sx={{ borderRadius: 3 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 1 }}>
          <Tabs
            value={activeTab}
            onChange={(_, val) => setActiveTab(val)}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab
              icon={<SavingsRounded fontSize="small" />}
              iconPosition="start"
              label="月度预算资金池 (Monthly Pools)"
              sx={{ fontWeight: 700 }}
            />
            <Tab
              icon={<FlagRounded fontSize="small" />}
              iconPosition="start"
              label="专项储蓄与心愿单 (Wish Goals)"
              sx={{ fontWeight: 700 }}
            />
            <Tab
              icon={<CategoryRounded fontSize="small" />}
              iconPosition="start"
              label="收支分类管理 (Categories)"
              sx={{ fontWeight: 700 }}
            />
          </Tabs>
        </Box>
      </Card>

      {/* ===================================================================== */}
      {/* Tab 0: 月度预算资金池 (Monthly Pools) */}
      {/* ===================================================================== */}
      {activeTab === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 顶栏：月份选择器与新增资金池操作 */}
          <Card sx={{ borderRadius: 3, p: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <CalendarMonthRounded color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  月度预算资金池管理
                </Typography>
                <TextField
                  type="month"
                  size="small"
                  value={yearMonth}
                  onChange={(e) => setYearMonth(e.target.value)}
                  sx={{ width: 160 }}
                />
              </Stack>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddRounded />}
                onClick={handleOpenAddPool}
              >
                新增资金池
              </Button>
            </Stack>
          </Card>

          {/* 顶部动态日均管控与月度总水位核心看板 */}
          <Grid container spacing={2}>
            {/* 左侧：动态日均管控看板 */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card
                sx={{
                  height: '100%',
                  borderRadius: 3,
                  bgcolor: (t) => (t.palette.mode === 'dark' ? 'grey.900' : 'primary.50'),
                  border: '1px solid',
                  borderColor: 'primary.main',
                }}
              >
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
                    <Chip
                      size="small"
                      color="primary"
                      label="动态日均管控引擎"
                      icon={<AutoAwesomeRounded />}
                    />
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                      高频生活池 · 今日剩余日均可用
                    </Typography>
                  </Stack>

                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, my: 1 }}>
                    <Typography variant="h5" sx={{ color: 'primary.main', fontWeight: 800 }}>
                      ¥
                    </Typography>
                    <Typography
                      variant="h3"
                      sx={{
                        fontWeight: 900,
                        color: 'primary.main',
                        letterSpacing: '-1px',
                        lineHeight: 1,
                      }}
                    >
                      {dailySummary.dailyAvailableAmount}
                    </Typography>
                    <Typography variant="subtitle1" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                      / 天
                    </Typography>
                  </Box>

                  <Typography
                    variant="caption"
                    sx={{
                      display: 'block',
                      fontFamily: 'monospace',
                      color: 'text.secondary',
                      bgcolor: 'background.paper',
                      p: 1,
                      borderRadius: 1.5,
                      mt: 1.5,
                      wordBreak: 'break-all',
                    }}
                  >
                    计算公式: {dailySummary.formula}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            {/* 右侧：月度常规总水位看板 */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card sx={{ height: '100%', borderRadius: 3 }}>
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                      月度常规池预算总水位
                    </Typography>
                    <Chip
                      size="small"
                      color="success"
                      label={`本月累计羊毛省钱 +¥${dailySummary.totalSavedWool}`}
                      variant="outlined"
                    />
                  </Stack>

                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, my: 1 }}>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: 'text.primary' }}>
                      ¥{totalMonthlyRemaining.toFixed(2)}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      可用结余 / 总额 ¥{totalMonthlyBudget.toFixed(2)}
                    </Typography>
                  </Box>

                  <Box sx={{ mt: 2 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        整体使用进度: {overallUsagePercent}%
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        已支出: ¥{totalMonthlySpent.toFixed(2)}
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={overallUsagePercent}
                      color={overallUsagePercent >= 100 ? 'error' : overallUsagePercent > 80 ? 'warning' : 'primary'}
                      sx={{ height: 8, borderRadius: 4 }}
                    />
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* 月度资金池卡片网格 (ONLY is_monthly_budget === true) */}
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary', mt: 1 }}>
            月度常规资金池列表 ({monthlyPoolStatuses.length} 个)
          </Typography>

          <Grid container spacing={2}>
            {monthlyPoolStatuses.map((pool) => {
              const totalAvail = Number(pool.total_available_budget);
              const spent = Number(pool.spent_net);
              const remaining = Number(pool.remaining_budget);
              const percent =
                totalAvail > 0 ? Math.min(100, Math.round((spent / totalAvail) * 100)) : 0;
              const isOverspent = remaining < 0;
              const poolDef = poolDefMap.get(pool.pool_id);
              const isDailyPool = pool.pool_id === 'POOL_DAILY';

              return (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={pool.pool_id}>
                  <Card
                    sx={{
                      height: '100%',
                      borderRadius: 3,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      border: isDailyPool ? '2px solid' : '1px solid',
                      borderColor: isDailyPool ? 'primary.main' : 'divider',
                      transition: 'transform 0.15s ease-in-out',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: 3,
                      },
                    }}
                  >
                    <CardContent sx={{ p: 2 }}>
                      {/* 卡片头部 */}
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                            {pool.pool_name}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                            {poolDef?.description || '月度预算管理资金池'}
                          </Typography>
                        </Box>
                        {getRolloverChip(poolDef?.rollover_strategy)}
                      </Stack>

                      {/* 额度详情 */}
                      <Box sx={{ my: 1.5 }}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            可用结余
                          </Typography>
                          <Typography
                            variant="h6"
                            sx={{
                              fontWeight: 800,
                              color: isOverspent ? 'error.main' : 'text.primary',
                            }}
                          >
                            ¥{pool.remaining_budget}
                          </Typography>
                        </Stack>

                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            本月支出净额
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            ¥{pool.spent_net}
                            {Number(pool.total_saved_discount) > 0 && (
                              <Typography component="span" variant="caption" sx={{ color: 'success.main', ml: 0.5 }}>
                                (省 ¥{pool.total_saved_discount})
                              </Typography>
                            )}
                          </Typography>
                        </Stack>

                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            基准分配额
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            ¥{pool.base_allocation}
                            {Number(pool.rollover_from_prev) !== 0 && (
                              <span> · 滚入 ¥{pool.rollover_from_prev}</span>
                            )}
                          </Typography>
                        </Stack>
                      </Box>

                      {/* 进度条 */}
                      <Box sx={{ mt: 1.5, mb: 1 }}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            进度: {percent}%
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            总额: ¥{pool.total_available_budget}
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={percent}
                          color={isOverspent ? 'error' : percent > 85 ? 'warning' : 'primary'}
                          sx={{ height: 6, borderRadius: 3 }}
                        />
                      </Box>

                      {/* 划转动作按钮 */}
                      {poolDef?.rollover_strategy === 'SWEEP_TO_FUND' && (
                        <Button
                          fullWidth
                          size="small"
                          variant="outlined"
                          color="info"
                          startIcon={<AutoAwesomeRounded />}
                          onClick={handleSweepDailyToFund}
                          sx={{ mt: 1.5, borderRadius: 2 }}
                        >
                          ✨ 月末结余一键划入专项沉淀
                        </Button>
                      )}
                    </CardContent>

                    {/* 卡片底栏操作 */}
                    <Box
                      sx={{
                        p: 1.5,
                        pt: 0,
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 1,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Tooltip title="编辑额度与属性">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenEditPool(pool)}
                        >
                          <EditRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除资金池">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeletePool(pool.pool_id, pool.pool_name)}
                        >
                          <DeleteOutlineRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}

      {/* ===================================================================== */}
      {/* Tab 1: 专项储蓄与心愿单 (Wish Goals) */}
      {/* ===================================================================== */}
      {activeTab === 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 年度专项基金池 (Sinking Fund Pool) 顶栏横幅 */}
          <Card
            sx={{
              borderRadius: 3,
              p: 2.5,
              background: (t) =>
                t.palette.mode === 'dark'
                  ? 'linear-gradient(135deg, rgba(124, 77, 255, 0.15) 0%, rgba(33, 150, 243, 0.15) 100%)'
                  : 'linear-gradient(135deg, #ede7f6 0%, #e3f2fd 100%)',
              border: '1px solid',
              borderColor: 'secondary.light',
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2.5}
              sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
            >
              <Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <StarsRounded color="secondary" />
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    年度专项基金沉淀池 (Sinking Fund Pool)
                  </Typography>
                  <Chip size="small" color="secondary" label="跨期储蓄保障" />
                </Stack>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {fundDef?.description ||
                    '承接每月生活饮食池结余划入，沉淀专款专用资金，为大额跨期立项与愿望清单提供确定性资金保障。'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 3, mt: 1.5 }}>
                  <Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      专项沉淀总可用额度
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 800, color: 'secondary.main' }}>
                      ¥{fundStatus?.total_available_budget || '0.00'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      已在专项中消耗
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 800, color: 'text.primary' }}>
                      ¥{fundStatus?.spent_net || '0.00'}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      剩余可用沉淀
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 800, color: 'success.main' }}>
                      ¥{fundStatus?.remaining_budget || '0.00'}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              <Button
                variant="contained"
                color="secondary"
                startIcon={<AddRounded />}
                onClick={() => handleOpenAddWish()}
                sx={{ borderRadius: 2, height: 42, px: 3, whiteSpace: 'nowrap' }}
              >
                新增心愿单 / 专项预算
              </Button>
            </Stack>
          </Card>

          {/* 心愿单列表 */}
          {engine.state.projectTags.length === 0 ? (
            /* 空状态友好引导卡片 */
            <Card sx={{ borderRadius: 3, p: 4, textAlign: 'center' }}>
              <FlagRounded sx={{ fontSize: 56, color: 'text.secondary', mb: 1 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                当前尚未创建任何专项立项与心愿单
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 500, mx: 'auto', mb: 3 }}>
                纯净账本模式下未预置测试数据。你可以创建如「考证报名与资料」、「寒假旅行基金」、「数码设备换新」等愿望清单，跟踪独立预算与累计开销！
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<AddRounded />}
                  onClick={() => handleOpenAddWish('考证报名与资料', '350.00')}
                >
                  创建示例: 考证报名与资料 (¥350.00)
                </Button>
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<AddRounded />}
                  onClick={() => handleOpenAddWish('寒假旅行基金', '1500.00')}
                >
                  创建示例: 寒假旅行基金 (¥1500.00)
                </Button>
                <Button
                  variant="outlined"
                  color="info"
                  startIcon={<AddRounded />}
                  onClick={() => handleOpenAddWish('换新电子设备', '3000.00')}
                >
                  创建示例: 换新电子设备 (¥3000.00)
                </Button>
              </Stack>
            </Card>
          ) : (
            <Grid container spacing={2}>
              {engine.state.projectTags.map((tag) => {
                // 计算当前心愿标签关联交易累计支出
                const relatedTxs = engine.state.transactions.filter(
                  (tx) =>
                    !tx.header.is_deleted &&
                    tx.items.some((it) => it.project_tag_id === tag.id)
                );

                const spentDec = relatedTxs
                  .flatMap((tx) => tx.items)
                  .filter((it) => it.project_tag_id === tag.id)
                  .reduce((acc, it) => acc.plus(toDecimal(it.item_net)), toDecimal(0));
                const spentStr = formatCny(spentDec);

                const targetDec = toDecimal(tag.target_budget || '0');
                const remainingDec = targetDec.minus(spentDec);
                const remainingStr = formatCny(remainingDec);

                const targetNum = targetDec.toNumber();
                const spentNum = spentDec.toNumber();
                const percent =
                  targetNum > 0 ? Math.min(100, Math.round((spentNum / targetNum) * 100)) : 0;

                return (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={tag.id}>
                    <Card
                      sx={{
                        height: '100%',
                        borderRadius: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        border: '1px solid',
                        borderColor: tag.is_active ? 'secondary.light' : 'divider',
                        transition: 'transform 0.15s ease-in-out',
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          boxShadow: 3,
                        },
                      }}
                    >
                      <CardContent sx={{ p: 2 }}>
                        {/* 头部信息 */}
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
                          <Box>
                            <Typography variant="h6" sx={{ fontWeight: 800, color: 'secondary.main' }}>
                              #{tag.name}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {tag.start_date || '开始未定'} ~ {tag.end_date || '长期'}
                            </Typography>
                          </Box>
                          <Stack direction="row" spacing={0.5}>
                            <Chip
                              size="small"
                              label={tag.tag_type === 'PROJECT' ? '专项心愿' : '场景标签'}
                              color="secondary"
                              variant="outlined"
                            />
                            {tag.is_active ? (
                              <Chip size="small" label="进行中" color="success" />
                            ) : (
                              <Chip size="small" label="已归档" />
                            )}
                          </Stack>
                        </Stack>

                        {/* 金额进度 */}
                        <Box sx={{ my: 1 }}>
                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              目标总预算
                            </Typography>
                            <Typography variant="body1" sx={{ fontWeight: 800 }}>
                              ¥{tag.target_budget || '0.00'}
                            </Typography>
                          </Stack>

                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              已消耗进度
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                              ¥{spentStr}
                            </Typography>
                          </Stack>

                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              剩余可用额度
                            </Typography>
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 800,
                                color: remainingDec.isNegative() ? 'error.main' : 'success.main',
                              }}
                            >
                              ¥{remainingStr}
                            </Typography>
                          </Stack>

                          <Box sx={{ mt: 1.5 }}>
                            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                完成度: {percent}%
                              </Typography>
                            </Stack>
                            <LinearProgress
                              variant="determinate"
                              value={percent}
                              color={percent >= 100 ? 'warning' : 'secondary'}
                              sx={{ height: 6, borderRadius: 3 }}
                            />
                          </Box>
                        </Box>

                        {/* 关联流水摘要 */}
                        <Divider sx={{ my: 1.5 }} />
                        <Box>
                          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <ReceiptLongRounded fontSize="inherit" />
                            关联明细流水 ({relatedTxs.length} 笔)
                          </Typography>
                          {relatedTxs.length === 0 ? (
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                              暂无记账流水关联此心愿
                            </Typography>
                          ) : (
                            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                              {relatedTxs.slice(0, 2).map((tx) => (
                                <Stack
                                  key={tx.header.id}
                                  direction="row"
                                  sx={{ justifyContent: 'space-between', fontSize: '0.75rem', color: 'text.secondary' }}
                                >
                                  <span>{tx.header.tx_date} {tx.header.merchant_or_note || '支出'}</span>
                                  <span style={{ fontWeight: 600 }}>¥{tx.header.total_net}</span>
                                </Stack>
                              ))}
                              {relatedTxs.length > 2 && (
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                  ... 更多 {relatedTxs.length - 2} 笔
                                </Typography>
                              )}
                            </Stack>
                          )}
                        </Box>
                      </CardContent>

                      {/* 底栏动作按钮 */}
                      <Box
                        sx={{
                          p: 1.5,
                          pt: 0,
                          display: 'flex',
                          justifyContent: 'flex-end',
                          gap: 1,
                          borderTop: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        <Tooltip title="编辑心愿单">
                          <IconButton
                            size="small"
                            color="secondary"
                            onClick={() => handleOpenEditWish(tag)}
                          >
                            <EditRounded fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除心愿单">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteWish(tag.id, tag.name)}
                          >
                            <DeleteOutlineRounded fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Card>
                  </Grid>
                );
              })}
            </Grid>
          )}
        </Box>
      )}

      {/* ===================================================================== */}
      {/* Tab 2: 收支分类管理 (Categories) */}
      {/* ===================================================================== */}
      {activeTab === 2 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 顶栏：分类管理头部 */}
          <Card sx={{ borderRadius: 3, p: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  收支分类与自动匹配规则
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  为消费自动关联默认预算池，并根据关键词智能匹配记账流水分拣
                </Typography>
              </Box>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddRounded />}
                onClick={handleOpenAddCategory}
              >
                新增收支分类
              </Button>
            </Stack>
          </Card>

          {/* 分类列表网格 */}
          <Grid container spacing={2}>
            {engine.state.categories.map((cat) => {
              const pool = poolDefMap.get(cat.default_pool_id);
              const kwList = (cat.keywords || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

              return (
                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={cat.id}>
                  <Card
                    sx={{
                      height: '100%',
                      borderRadius: 3,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <CardContent sx={{ p: 2 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Typography variant="h5">{cat.icon_name || '🏷️'}</Typography>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {cat.name}
                          </Typography>
                        </Stack>
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={pool ? pool.name : cat.default_pool_id}
                        />
                      </Stack>

                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                        默认绑定资金池: <strong>{pool?.name || cat.default_pool_id}</strong>
                      </Typography>

                      <Box sx={{ mt: 1 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          自动匹配关键词 ({kwList.length}):
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {kwList.length > 0 ? (
                            kwList.map((kw, i) => (
                              <Chip
                                key={i}
                                label={kw}
                                size="small"
                                sx={{ fontSize: '0.75rem', height: 22 }}
                              />
                            ))
                          ) : (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              暂无关键词
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    </CardContent>

                    <Box
                      sx={{
                        p: 1.5,
                        pt: 0,
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: 1,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Tooltip title="编辑分类">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenEditCategory(cat)}
                        >
                          <EditRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除分类">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteCategory(cat.id, cat.name)}
                        >
                          <DeleteOutlineRounded fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      )}

      {/* ===================================================================== */}
      {/* 弹窗 1: 资金池编辑 / 新增 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={poolModalOpen}
        onClose={() => setPoolModalOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {poolEditingId ? `编辑资金池: ${poolForm.name}` : '新增月度资金池'}
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="资金池名称"
            fullWidth
            size="small"
            value={poolForm.name}
            onChange={(e) => setPoolForm({ ...poolForm, name: e.target.value })}
            placeholder="如: 高频生活饮食池"
          />

          <FormControl fullWidth size="small">
            <InputLabel>池职能分类 (Pool Type)</InputLabel>
            <Select
              value={poolForm.pool_type}
              label="池职能分类 (Pool Type)"
              onChange={(e) =>
                setPoolForm({ ...poolForm, pool_type: e.target.value as PoolType })
              }
              disabled={Boolean(poolEditingId)} // 已创建池保留原有职能
            >
              <MenuItem value="DAILY">DAILY - 高频生活池 (动态日均管控)</MenuItem>
              <MenuItem value="FIXED">FIXED - 固定刚需与定投池</MenuItem>
              <MenuItem value="FLEX">FLEX - 月度弹性发展池</MenuItem>
              <MenuItem value="EMERGENCY">EMERGENCY - 突发应急池</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>月末结余滚存策略</InputLabel>
            <Select
              value={poolForm.rollover_strategy}
              label="月末结余滚存策略"
              onChange={(e) =>
                setPoolForm({
                  ...poolForm,
                  rollover_strategy: e.target.value as RolloverStrategy,
                })
              }
            >
              <MenuItem value="RESET">RESET - 月末清零 (零基预算)</MenuItem>
              <MenuItem value="SWEEP_TO_FUND">SWEEP_TO_FUND - 结余划转专项沉淀基金</MenuItem>
              <MenuItem value="ACCUMULATE">ACCUMULATE - 全额滚存至下月同池</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label={`本月 (${yearMonth}) 基准分配预算 (¥)`}
            fullWidth
            size="small"
            type="number"
            value={poolForm.base_allocation}
            onChange={(e) => setPoolForm({ ...poolForm, base_allocation: e.target.value })}
            placeholder="如 1200.00"
          />

          <TextField
            label="资金池说明与管控规则"
            fullWidth
            size="small"
            multiline
            rows={2}
            value={poolForm.description}
            onChange={(e) => setPoolForm({ ...poolForm, description: e.target.value })}
            placeholder="如: 每日正餐、水果、零食开销，按日动态均摊管控"
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setPoolModalOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSavePool}>
            保存资金池与额度
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===================================================================== */}
      {/* 弹窗 2: 心愿单编辑 / 新增 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={wishModalOpen}
        onClose={() => setWishModalOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {wishEditingId ? `编辑心愿专项: ${wishForm.name}` : '新增心愿单 / 专项预算'}
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="心愿 / 专项名称"
            fullWidth
            size="small"
            value={wishForm.name}
            onChange={(e) => setWishForm({ ...wishForm, name: e.target.value })}
            placeholder="如: 考证报名与资料"
          />

          <TextField
            label="目标总预算金额 (¥)"
            fullWidth
            size="small"
            type="number"
            value={wishForm.target_budget}
            onChange={(e) => setWishForm({ ...wishForm, target_budget: e.target.value })}
            placeholder="如: 350.00"
          />

          <FormControl fullWidth size="small">
            <InputLabel>标签类型</InputLabel>
            <Select
              value={wishForm.tag_type}
              label="标签类型"
              onChange={(e) => setWishForm({ ...wishForm, tag_type: e.target.value as TagType })}
            >
              <MenuItem value="PROJECT">PROJECT - 专项立项 (跨月追踪)</MenuItem>
              <MenuItem value="SCENE">SCENE - 消费场景标签</MenuItem>
              <MenuItem value="STOCK_CONSUME">STOCK_CONSUME - 零元消耗打卡标记</MenuItem>
            </Select>
          </FormControl>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="开始日期"
              fullWidth
              size="small"
              type="date"
              value={wishForm.start_date}
              onChange={(e) => setWishForm({ ...wishForm, start_date: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="预期完成日期"
              fullWidth
              size="small"
              type="date"
              value={wishForm.end_date}
              onChange={(e) => setWishForm({ ...wishForm, end_date: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          <FormControl fullWidth size="small">
            <InputLabel>关联预算沉淀池</InputLabel>
            <Select
              value={wishForm.linked_pool_id}
              label="关联预算沉淀池"
              onChange={(e) => setWishForm({ ...wishForm, linked_pool_id: e.target.value })}
            >
              <MenuItem value="POOL_FUND">POOL_FUND - 年度专项基金池</MenuItem>
              {engine.state.budgetPools
                .filter((p) => p.id !== 'POOL_FUND')
                .map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.id} - {p.name}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={wishForm.is_active}
                onChange={(e) => setWishForm({ ...wishForm, is_active: e.target.checked })}
              />
            }
            label={wishForm.is_active ? '进行中心愿 (活跃状态)' : '已达成/归档心愿'}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setWishModalOpen(false)}>取消</Button>
          <Button variant="contained" color="secondary" onClick={handleSaveWish}>
            保存心愿单
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===================================================================== */}
      {/* 弹窗 3: 收支分类编辑 / 新增 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {catEditingId ? `编辑收支分类: ${catForm.name}` : '新增收支分类'}
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="分类名称"
            fullWidth
            size="small"
            value={catForm.name}
            onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
            placeholder="如: 三餐正餐"
          />

          <TextField
            label="图标 Emoji / 图标标识"
            fullWidth
            size="small"
            value={catForm.icon_name}
            onChange={(e) => setCatForm({ ...catForm, icon_name: e.target.value })}
            placeholder="如: 🍱 或 🍜"
          />

          <FormControl fullWidth size="small">
            <InputLabel>默认绑定资金池</InputLabel>
            <Select
              value={catForm.default_pool_id}
              label="默认绑定资金池"
              onChange={(e) => setCatForm({ ...catForm, default_pool_id: e.target.value })}
            >
              {engine.state.budgetPools.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="智能分拣关键词 (英文逗号分隔)"
            fullWidth
            size="small"
            multiline
            rows={2}
            value={catForm.keywords}
            onChange={(e) => setCatForm({ ...catForm, keywords: e.target.value })}
            placeholder="如: 食堂,外卖,美团,饿了么,肯德基,麦当劳"
            helperText="记账 DSL 解析时，命中上述关键词将自动匹配到此分类"
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCatModalOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSaveCategory}>
            保存收支分类
          </Button>
        </DialogActions>
      </Dialog>

      {/* 全局反馈提示 Toast */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3500}
        onClose={() => setToast({ ...toast, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={toast.severity}
          onClose={() => setToast({ ...toast, open: false })}
          sx={{ width: '100%', borderRadius: 2 }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};
