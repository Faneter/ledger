import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
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
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import BoltRounded from '@mui/icons-material/BoltRounded';

import {
  RecurringRule,
  RecurringRuleType,
  CronCycle,
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
  // 1. 全局反馈提示 Toast
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

  // ===========================================================================
  // 弹窗状态与表单模型
  // ===========================================================================

  // 周期规则编辑/新增弹窗
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
  // 周期性规则操作逻辑
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
      {/* 周期性扣款 (Recurring Rules) */}
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

      {/* ===================================================================== */}
      {/* 弹窗：周期规则新增与编辑 Dialog */}
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
