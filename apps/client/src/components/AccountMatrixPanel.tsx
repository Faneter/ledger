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
  Grid,
  Stack,
  Alert,
  Snackbar,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ConfirmationNumberRounded from '@mui/icons-material/ConfirmationNumberRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import BoltRounded from '@mui/icons-material/BoltRounded';

import {
  RecurringRule,
  RecurringRuleType,
  CronCycle,
  Voucher,
  VoucherType,
  generateVoucherTitle,
} from '@ledger/core';
import { LocalLedgerEngine } from '../sync/local-replica';

export interface AccountMatrixPanelProps {
  engine: LocalLedgerEngine;
  onRefresh?: () => void;
}

export const AccountMatrixPanel: React.FC<AccountMatrixPanelProps> = ({
  engine,
  onRefresh,
}) => {
  // 1. 标签页控制 (0: 优惠券卡包, 1: 周期性扣款)
  const [activeTab, setActiveTab] = useState(0);

  // 2. 全局反馈提示 Toast
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

  // 优惠券过滤器 ('ALL' | 'AVAILABLE' | 'USED' | 'EXPIRED')
  const [voucherFilter, setVoucherFilter] = useState<string>('ALL');

  const filteredVouchers = useMemo(() => {
    if (voucherFilter === 'ALL') return engine.state.vouchers;
    return engine.state.vouchers.filter((v) => v.status === voucherFilter);
  }, [engine.stateVersion, voucherFilter]);

  // ===========================================================================
  // 弹窗状态与表单模型
  // ===========================================================================

  // 1. 优惠券编辑/登记弹窗
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);
  const [voucherEditingId, setVoucherEditingId] = useState<number | null>(null);
  const [voucherMode, setVoucherMode] = useState<'FREE' | 'BUY' | 'EDIT'>('FREE');
  const [voucherForm, setVoucherForm] = useState<{
    customPrefix: string;
    title: string;
    voucher_type: VoucherType;
    face_value: string;
    acquire_cost: string;
    min_spend: string;
    expire_date: string;
    status: 'AVAILABLE' | 'USED' | 'EXPIRED';
  }>({
    customPrefix: '',
    title: '',
    voucher_type: 'FREE_COUPON',
    face_value: '',
    acquire_cost: '',
    min_spend: '',
    expire_date: '',
    status: 'AVAILABLE',
  });

  // 2. 周期规则编辑/新增弹窗
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleEditingId, setRuleEditingId] = useState<number | null>(null);
  const [ruleForm, setRuleForm] = useState<{
    title: string;
    rule_type: RecurringRuleType;
    cron_cycle: CronCycle;
    trigger_day: string;
    currency: string;
    amount: string;
    budget_pool_id: string;
    auto_reserve_budget: boolean;
  }>({
    title: '',
    rule_type: 'FIXED_EXPENSE',
    cron_cycle: 'MONTHLY',
    trigger_day: '',
    currency: 'CNY',
    amount: '',
    budget_pool_id: 'POOL_FIXED',
    auto_reserve_budget: true,
  });

  // ===========================================================================
  // Tab 0: 优惠券卡包操作逻辑
  // ===========================================================================

  const handleOpenFreeVoucherModal = (sampleTitle?: string, sampleFace?: string, sampleMin?: string) => {
    setVoucherEditingId(null);
    setVoucherMode('FREE');
    setVoucherForm({
      customPrefix: '',
      title: sampleTitle || '',
      voucher_type: 'FREE_COUPON',
      face_value: sampleFace || '',
      acquire_cost: '',
      min_spend: sampleMin || '',
      expire_date: '',
      status: 'AVAILABLE',
    });
    setVoucherModalOpen(true);
  };

  const handleOpenBuyVoucherModal = (sampleTitle?: string, sampleFace?: string, sampleCost?: string, sampleMin?: string) => {
    setVoucherEditingId(null);
    setVoucherMode('BUY');
    setVoucherForm({
      customPrefix: '',
      title: sampleTitle || '',
      voucher_type: 'PREPAID_COUPON',
      face_value: sampleFace || '',
      acquire_cost: sampleCost || '',
      min_spend: sampleMin || '',
      expire_date: '',
      status: 'AVAILABLE',
    });
    setVoucherModalOpen(true);
  };

  const handleOpenEditVoucher = (v: Voucher) => {
    setVoucherEditingId(v.id);
    setVoucherMode('EDIT');
    setVoucherForm({
      customPrefix: '',
      title: v.title,
      voucher_type: v.voucher_type,
      face_value: v.face_value,
      acquire_cost: v.acquire_cost,
      min_spend: v.min_spend,
      expire_date: v.expire_date || '',
      status: (v.status === 'REFUNDED' ? 'USED' : v.status) as 'AVAILABLE' | 'USED' | 'EXPIRED',
    });
    setVoucherModalOpen(true);
  };

  const handleSaveVoucher = () => {
    if (isNaN(Number(voucherForm.face_value)) || Number(voucherForm.face_value) <= 0) {
      showToast('请输入有效的面值金额', 'warning');
      return;
    }

    const resolvedCost = voucherForm.acquire_cost.trim() || '0.00';
    const resolvedMinSpend = voucherForm.min_spend.trim() || '0.00';

    const autoTitle = generateVoucherTitle(
      voucherForm.voucher_type,
      voucherForm.face_value,
      resolvedMinSpend,
      resolvedCost
    );
    const resolvedTitle = voucherForm.customPrefix.trim()
      ? `${voucherForm.customPrefix.trim()} ${autoTitle}`
      : voucherMode === 'EDIT' && voucherForm.title.trim()
      ? voucherForm.title.trim()
      : autoTitle;

    try {
      if (voucherMode === 'BUY') {
        engine.buyVoucher({
          title: resolvedTitle,
          voucher_type: voucherForm.voucher_type,
          face_value: voucherForm.face_value,
          acquire_cost: resolvedCost,
          min_spend: resolvedMinSpend,
          expire_date: voucherForm.expire_date || null,
        });
        showToast(
          `成功购入立减金【${resolvedTitle}】，已扣款 ¥${resolvedCost}`,
          'success'
        );
      } else {
        engine.upsertVoucher({
          id: voucherEditingId || undefined,
          title: resolvedTitle,
          voucher_type: voucherForm.voucher_type,
          face_value: voucherForm.face_value,
          acquire_cost: resolvedCost,
          min_spend: resolvedMinSpend,
          expire_date: voucherForm.expire_date || null,
          status: voucherForm.status,
        });
        showToast(
          voucherEditingId
            ? `卡券【${resolvedTitle}】已更新`
            : `成功登记免费卡券【${resolvedTitle}】`,
          'success'
        );
      }

      setVoucherModalOpen(false);
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleDeleteVoucher = (vId: number, vTitle: string) => {
    if (!window.confirm(`确定要删除优惠券【${vTitle}】吗？`)) return;
    try {
      engine.deleteVoucher(vId);
      showToast(`优惠券【${vTitle}】已删除`, 'success');
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // ===========================================================================
  // Tab 1: 周期性规则操作逻辑
  // ===========================================================================

  const handleOpenAddRule = (sampleTitle?: string, sampleAmt?: string, sampleDay?: number, sampleType?: RecurringRuleType) => {
    setRuleEditingId(null);
    const ruleType = sampleType || 'FIXED_EXPENSE';
    setRuleForm({
      title: sampleTitle || '',
      rule_type: ruleType,
      cron_cycle: 'MONTHLY',
      trigger_day: sampleDay ? String(sampleDay) : '',
      currency: ruleType === 'FX_SUBSCRIPTION' ? 'USD' : 'CNY',
      amount: sampleAmt || '',
      budget_pool_id: 'POOL_FIXED',
      auto_reserve_budget: true,
    });
    setRuleModalOpen(true);
  };

  const handleOpenEditRule = (r: RecurringRule) => {
    setRuleEditingId(r.id);
    setRuleForm({
      title: r.title,
      rule_type: r.rule_type,
      cron_cycle: r.cron_cycle,
      trigger_day: String(r.trigger_day),
      currency: r.currency || 'CNY',
      amount: r.amount,
      budget_pool_id: r.budget_pool_id || 'POOL_FIXED',
      auto_reserve_budget: r.auto_reserve_budget,
    });
    setRuleModalOpen(true);
  };

  const handleSaveRule = () => {
    if (!ruleForm.title.trim()) {
      showToast('请输入周期规则名称', 'warning');
      return;
    }
    if (isNaN(Number(ruleForm.amount)) || Number(ruleForm.amount) <= 0) {
      showToast('请输入有效的规则金额', 'warning');
      return;
    }

    const parsedDay = Math.min(31, Math.max(1, Math.round(Number(ruleForm.trigger_day) || 1)));
    const derivedRuleType: RecurringRuleType =
      ruleForm.currency === 'CNY' ? 'FIXED_EXPENSE' : 'FX_SUBSCRIPTION';

    try {
      engine.upsertRecurringRule({
        id: ruleEditingId || undefined,
        title: ruleForm.title.trim(),
        rule_type: derivedRuleType,
        cron_cycle: ruleForm.cron_cycle,
        trigger_day: parsedDay,
        currency: ruleForm.currency,
        amount: ruleForm.amount,
        account_id: 'ACC_UNION_MAIN',
        target_account_id: null,
        budget_pool_id: ruleForm.budget_pool_id || null,
        category_id: null,
        auto_reserve_budget: ruleForm.auto_reserve_budget,
      });

      showToast(
        ruleEditingId
          ? `周期规则【${ruleForm.title}】已更新`
          : `已新增周期规则【${ruleForm.title}】`,
        'success'
      );
      setRuleModalOpen(false);
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleDeleteRule = (rId: number, rTitle: string) => {
    if (!window.confirm(`确定要删除周期规则【${rTitle}】吗？`)) return;
    try {
      engine.deleteRecurringRule(rId);
      showToast(`周期规则【${rTitle}】已删除`, 'success');
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleExecuteRule = (r: RecurringRule) => {
    try {
      const tx = engine.executeRecurringRule(r.id);
      showToast(
        `⚡ 已立即执行周期扣款记账！实付 ¥${tx.header.total_net}`,
        'success'
      );
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* 顶部主选项卡切换 */}
      <Card>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 1 }}>
          <Tabs
            value={activeTab}
            onChange={(_, val) => setActiveTab(val)}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab
              icon={<ConfirmationNumberRounded fontSize="small" />}
              iconPosition="start"
              label="优惠券卡包"
              sx={{ fontWeight: 700 }}
            />
            <Tab
              icon={<EventRepeatRounded fontSize="small" />}
              iconPosition="start"
              label="周期性扣款"
              sx={{ fontWeight: 700 }}
            />
          </Tabs>
        </Box>
      </Card>

      {/* ===================================================================== */}
      {/* Tab 0: 优惠券卡包 (Vouchers) */}
      {/* ===================================================================== */}
      {activeTab === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 顶栏：卡券过滤与新增操作 */}
          <Card sx={{ p: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mr: 1 }}>
                  卡券状态过滤:
                </Typography>
                {[
                  { key: 'ALL', label: '全部' },
                  { key: 'AVAILABLE', label: '待核销/可用' },
                  { key: 'USED', label: '已核销' },
                  { key: 'EXPIRED', label: '已过期' },
                ].map((item) => (
                  <Chip
                    key={item.key}
                    label={item.label}
                    color={voucherFilter === item.key ? 'primary' : 'default'}
                    variant={voucherFilter === item.key ? 'filled' : 'outlined'}
                    onClick={() => setVoucherFilter(item.key)}
                  />
                ))}
              </Stack>

              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  color="success"
                  startIcon={<AddRounded />}
                  onClick={() => handleOpenFreeVoucherModal()}
                >
                  免费领券登记
                </Button>
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={<AddRounded />}
                  onClick={() => handleOpenBuyVoucherModal()}
                >
                  有偿购券入库
                </Button>
              </Stack>
            </Stack>
          </Card>

          {/* 卡券空状态 */}
          {filteredVouchers.length === 0 ? (
            <Card sx={{ p: 4, textAlign: 'center' }}>
              <ConfirmationNumberRounded sx={{ fontSize: 56, color: 'text.secondary', mb: 1 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                当前卡包中没有符合条件的立减金或优惠券
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 500, mx: 'auto', mb: 3 }}>
                纯净模式下未预置任何测试卡券。你可以点击上方按钮免费登记平台券，或快捷录入示例券体验立减金凑单等比分摊：
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  color="success"
                  startIcon={<AddRounded />}
                  onClick={() =>
                    handleOpenFreeVoucherModal('平台通用优惠券', '5.00', '50.00')
                  }
                >
                  添加示例: 满50减5平台优惠券 (面值 ¥5.00 / 满 ¥50.00)
                </Button>
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<AddRounded />}
                  onClick={() =>
                    handleOpenBuyVoucherModal('微信支付10元立减金', '10.00', '5.99', '10.01')
                  }
                >
                  添加示例: 有偿购入立减金 (面值 ¥10.00 / 购券成本 ¥5.99)
                </Button>
              </Stack>
            </Card>
          ) : (
            <Grid container spacing={2}>
              {filteredVouchers.map((v) => {
                const isAvail = v.status === 'AVAILABLE';
                const isPaid = Number(v.acquire_cost) > 0;
                const netSaved = (Number(v.face_value) - Number(v.acquire_cost)).toFixed(2);

                return (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={v.id}>
                    <Card
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        border: '1px solid',
                        borderColor: isAvail ? (isPaid ? 'primary.main' : 'success.main') : 'divider',
                        opacity: isAvail ? 1 : 0.75,
                        transition: 'transform 0.15s ease-in-out',
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          boxShadow: 3,
                        },
                      }}
                    >
                      <CardContent sx={{ p: 2 }}>
                        {/* 头部信息 */}
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                            {v.title}
                          </Typography>
                          <Stack direction="row" spacing={0.5}>
                            <Chip
                              size="small"
                              label={
                                v.voucher_type === 'PREPAID_COUPON'
                                  ? '有偿立减金'
                                  : '免费平台券'
                              }
                              color={
                                v.voucher_type === 'PREPAID_COUPON'
                                  ? 'primary'
                                  : 'success'
                              }
                            />
                            <Chip
                              size="small"
                              label={
                                v.status === 'AVAILABLE'
                                  ? '待核销'
                                  : v.status === 'USED'
                                  ? '已使用'
                                  : '已过期'
                              }
                              color={
                                v.status === 'AVAILABLE'
                                  ? 'success'
                                  : v.status === 'EXPIRED'
                                  ? 'error'
                                  : 'default'
                              }
                              variant={v.status === 'AVAILABLE' ? 'filled' : 'outlined'}
                            />
                          </Stack>
                        </Stack>

                        {/* 金额详情 */}
                        <Box sx={{ my: 1.5 }}>
                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              抵扣面值金额
                            </Typography>
                            <Typography variant="h5" sx={{ fontWeight: 900, color: 'success.main' }}>
                              ¥{v.face_value}
                            </Typography>
                          </Stack>

                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              实付购券成本
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              ¥{v.acquire_cost}
                            </Typography>
                          </Stack>

                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              使用门槛
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              满 ¥{v.min_spend} 可用 · 净省 ¥{netSaved}
                            </Typography>
                          </Stack>

                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                            有效期限: {v.expire_date || '长期有效'}
                          </Typography>
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
                        <Tooltip title="编辑卡券">
                          <IconButton size="small" color="primary" onClick={() => handleOpenEditVoucher(v)}>
                            <EditRounded fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除卡券">
                          <IconButton size="small" color="error" onClick={() => handleDeleteVoucher(v.id, v.title)}>
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
      {/* Tab 1: 周期性扣款 (Recurring Rules) */}
      {/* ===================================================================== */}
      {activeTab === 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 顶栏：周期规则头部 */}
          <Card sx={{ p: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  周期性扣款规则
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  管理校园网宽带、外币云服务订阅等周期支出规则，支持到期一键生成记账流水
                </Typography>
              </Box>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AddRounded />}
                onClick={() => handleOpenAddRule()}
              >
                新增周期规则
              </Button>
            </Stack>
          </Card>

          {/* 规则空状态 */}
          {engine.state.recurringRules.length === 0 ? (
            <Card sx={{ p: 4, textAlign: 'center' }}>
              <EventRepeatRounded sx={{ fontSize: 56, color: 'text.secondary', mb: 1 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                暂无任何周期性扣款规则
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 500, mx: 'auto', mb: 3 }}>
                纯净模式下未预置测试规则。你可以点击下方按钮一键载入常见周期扣款模板：
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<AddRounded />}
                  onClick={() =>
                    handleOpenAddRule('校园网固定宽带', '20.00', 1, 'FIXED_EXPENSE')
                  }
                >
                  创建示例: 校园网宽带月租 (¥20.00 / 每月 1 日)
                </Button>
                <Button
                  variant="outlined"
                  color="info"
                  startIcon={<AddRounded />}
                  onClick={() =>
                    handleOpenAddRule('iCloud 50GB 存储订阅', '6.00', 10, 'FX_SUBSCRIPTION')
                  }
                >
                  创建示例: iCloud 50GB 订阅 (¥6.00 / 每月 10 日)
                </Button>
              </Stack>
            </Card>
          ) : (
            <Grid container spacing={2}>
              {engine.state.recurringRules.map((rule) => {
                return (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={rule.id}>
                    <Card
                      sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        border: '1px solid',
                        borderColor: rule.is_active ? 'primary.main' : 'divider',
                        transition: 'transform 0.15s ease-in-out',
                        '&:hover': {
                          transform: 'translateY(-2px)',
                          boxShadow: 3,
                        },
                      }}
                    >
                      <CardContent sx={{ p: 2 }}>
                        {/* 头部 */}
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                            {rule.title}
                          </Typography>
                          <Chip
                            size="small"
                            label={
                              rule.rule_type === 'FX_SUBSCRIPTION'
                                ? '外币周期订阅'
                                : '固定生活开支'
                            }
                            color={
                              rule.rule_type === 'FX_SUBSCRIPTION'
                                ? 'info'
                                : 'primary'
                            }
                          />
                        </Stack>

                        {/* 金额与周期 */}
                        <Box sx={{ my: 1.5 }}>
                          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              计划扣款金额
                            </Typography>
                            <Typography variant="h5" sx={{ fontWeight: 900, color: 'text.primary' }}>
                              {rule.currency === 'CNY' ? '¥' : `${rule.currency} `}{rule.amount}
                            </Typography>
                          </Stack>

                          <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
                            周期频次: {rule.cron_cycle === 'MONTHLY' ? '每月' : '每年'} 第 {rule.trigger_day} 日自动触发
                          </Typography>

                          {rule.budget_pool_id && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                              绑定资金池: <strong>{engine.state.budgetPools.find((p) => p.id === rule.budget_pool_id)?.name || rule.budget_pool_id}</strong>
                            </Typography>
                          )}

                          {rule.auto_reserve_budget && (
                            <Chip
                              size="small"
                              label="月初自动预留预算"
                              color="info"
                              variant="outlined"
                              sx={{ mt: 1 }}
                            />
                          )}
                        </Box>

                        {/* 一键立即执行记账 */}
                        <Button
                          fullWidth
                          size="small"
                          variant="contained"
                          color="primary"
                          startIcon={<BoltRounded />}
                          onClick={() => handleExecuteRule(rule)}
                          sx={{ mt: 1.5 }}
                        >
                          ⚡ 立即执行记账
                        </Button>
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
                        <Tooltip title="编辑规则">
                          <IconButton size="small" color="primary" onClick={() => handleOpenEditRule(rule)}>
                            <EditRounded fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除规则">
                          <IconButton size="small" color="error" onClick={() => handleDeleteRule(rule.id, rule.title)}>
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
      {/* 弹窗 1: 优惠券编辑 / 登记 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={voucherModalOpen}
        onClose={() => setVoucherModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {voucherMode === 'BUY'
            ? '有偿购券入库登记'
            : voucherMode === 'EDIT'
            ? `编辑卡券: ${voucherForm.title}`
            : '免费领券登记'}
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="备注前缀（选填，如：微信/招行，不填自动生成名称）"
            fullWidth
            size="small"
            value={voucherForm.customPrefix}
            onChange={(e) =>
              setVoucherForm({ ...voucherForm, customPrefix: e.target.value })
            }
            placeholder="如: 微信 / 招行"
          />

          <Box
            sx={{
              p: 1.2,
              borderRadius: '12px',
              bgcolor: (t) =>
                t.palette.mode === 'light'
                  ? alpha(t.palette.primary.main, 0.08)
                  : alpha(t.palette.primary.main, 0.16),
              border: '1px dashed',
              borderColor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              自动生成卡券名称：
            </Typography>
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={
                Number(voucherForm.face_value) > 0
                  ? `${voucherForm.customPrefix.trim() ? voucherForm.customPrefix.trim() + ' ' : ''}${generateVoucherTitle(
                      voucherForm.voucher_type,
                      voucherForm.face_value,
                      voucherForm.min_spend || '0.00',
                      voucherForm.acquire_cost || '0.00'
                    )}`
                  : '填写面值后自动生成'
              }
              sx={{ fontWeight: 700 }}
            />
          </Box>

          <FormControl fullWidth size="small">
            <InputLabel>卡券类型</InputLabel>
            <Select
              value={voucherForm.voucher_type}
              label="卡券类型"
              onChange={(e) =>
                setVoucherForm({
                  ...voucherForm,
                  voucher_type: e.target.value as VoucherType,
                })
              }
            >
              <MenuItem value="PREPAID_COUPON">有偿购买立减金</MenuItem>
              <MenuItem value="FREE_COUPON">免费平台优惠券</MenuItem>
            </Select>
          </FormControl>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="面值金额 (¥)"
              fullWidth
              size="small"
              type="number"
              value={voucherForm.face_value}
              onChange={(e) => setVoucherForm({ ...voucherForm, face_value: e.target.value })}
              placeholder="如 10.00"
            />
            <TextField
              label="实付购券成本 (¥)"
              fullWidth
              size="small"
              type="number"
              value={voucherForm.acquire_cost}
              onChange={(e) => setVoucherForm({ ...voucherForm, acquire_cost: e.target.value })}
              placeholder="免费领券填 0.00"
              disabled={voucherMode === 'FREE'}
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="最低使用门槛 (满 ¥ 可用)"
              fullWidth
              size="small"
              type="number"
              value={voucherForm.min_spend}
              onChange={(e) => setVoucherForm({ ...voucherForm, min_spend: e.target.value })}
              placeholder="如 10.01"
            />
            <TextField
              label="有效截止日期"
              fullWidth
              size="small"
              type="date"
              value={voucherForm.expire_date}
              onChange={(e) => setVoucherForm({ ...voucherForm, expire_date: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          {voucherMode === 'EDIT' && (
            <FormControl fullWidth size="small">
              <InputLabel>卡券状态</InputLabel>
              <Select
                value={voucherForm.status}
                label="卡券状态"
                onChange={(e) =>
                  setVoucherForm({
                    ...voucherForm,
                    status: e.target.value as 'AVAILABLE' | 'USED' | 'EXPIRED',
                  })
                }
              >
                <MenuItem value="AVAILABLE">待核销 / 可用</MenuItem>
                <MenuItem value="USED">已核销使用</MenuItem>
                <MenuItem value="EXPIRED">已过期失效</MenuItem>
              </Select>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setVoucherModalOpen(false)}>取消</Button>
          <Button
            variant="contained"
            color={voucherMode === 'BUY' ? 'primary' : 'success'}
            onClick={handleSaveVoucher}
          >
            {voucherMode === 'BUY' ? '确认支付购券入库' : '保存优惠券'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===================================================================== */}
      {/* 弹窗 2: 周期规则新增与编辑 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {ruleEditingId ? `编辑周期规则: ${ruleForm.title}` : '新增周期扣款规则'}
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="规则标题 / 说明"
            fullWidth
            size="small"
            value={ruleForm.title}
            onChange={(e) => setRuleForm({ ...ruleForm, title: e.target.value })}
            placeholder="如: 校园网固定宽带 / iCloud 50GB 存储订阅"
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>触发周期</InputLabel>
              <Select
                value={ruleForm.cron_cycle}
                label="触发周期"
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, cron_cycle: e.target.value as CronCycle })
                }
              >
                <MenuItem value="MONTHLY">每月触发</MenuItem>
                <MenuItem value="YEARLY">每年触发</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel>币种</InputLabel>
              <Select
                value={ruleForm.currency}
                label="币种"
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, currency: e.target.value })
                }
              >
                <MenuItem value="CNY">CNY 人民币</MenuItem>
                <MenuItem value="USD">USD 美元</MenuItem>
                <MenuItem value="EUR">EUR 欧元</MenuItem>
                <MenuItem value="JPY">JPY 日元</MenuItem>
                <MenuItem value="GBP">GBP 英镑</MenuItem>
                <MenuItem value="HKD">HKD 港币</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={`扣款金额 (${ruleForm.currency})`}
              fullWidth
              size="small"
              type="number"
              value={ruleForm.amount}
              onChange={(e) => setRuleForm({ ...ruleForm, amount: e.target.value })}
              placeholder="如 20.00"
            />

            <TextField
              label="每月触发日 (1~31)"
              fullWidth
              size="small"
              type="number"
              value={ruleForm.trigger_day}
              onChange={(e) => setRuleForm({ ...ruleForm, trigger_day: e.target.value })}
              placeholder="如 1"
            />
          </Stack>

          <FormControl fullWidth size="small">
            <InputLabel>绑定资金池</InputLabel>
            <Select
              value={ruleForm.budget_pool_id}
              label="绑定资金池"
              onChange={(e) => setRuleForm({ ...ruleForm, budget_pool_id: e.target.value })}
            >
              {engine.state.budgetPools
                .filter((p) => p.is_monthly_budget)
                .map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={ruleForm.auto_reserve_budget}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, auto_reserve_budget: e.target.checked })
                }
              />
            }
            label="在月度预算中预留此固定支出"
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setRuleModalOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSaveRule}>
            保存周期规则
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
          sx={{ width: '100%' }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};
