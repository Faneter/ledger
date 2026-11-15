import React, { useState, useMemo, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  TextField,
  MenuItem,
  Button,
  Chip,
  Grid,
  Stack,
  Alert,
  Snackbar,
  Divider,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
  InputAdornment,
} from '@mui/material';
import TrendingDownRounded from '@mui/icons-material/TrendingDownRounded';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded';
import FlashOnRounded from '@mui/icons-material/FlashOnRounded';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import LocalOfferRounded from '@mui/icons-material/LocalOfferRounded';
import { LocalLedgerEngine } from '../sync/local-replica';
import {
  Voucher,
  DEFAULT_FX_RATES,
  toDecimal,
  roundCny,
  formatCny,
  getLocalTodayDateStr,
} from '@ledger/core';

export interface QuickInputBarProps {
  engine: LocalLedgerEngine;
  onSuccess?: () => void;
  onRecordSuccess?: () => void;
}

export const QuickInputBar: React.FC<QuickInputBarProps> = ({
  engine,
  onSuccess,
  onRecordSuccess,
}) => {
  // 记账模式：'visual' (可视化表单) | 'dsl' (极速算式 DSL)
  const [mode, setMode] = useState<'visual' | 'dsl'>('visual');

  // 订阅引擎状态变更，确保卡券核销、设置更新等无需刷新即可响应
  const [, setEngineVersion] = useState(() => engine.stateVersion);
  useEffect(() => {
    return engine.subscribe(() => {
      setEngineVersion(engine.stateVersion);
    });
  }, [engine]);

  // 通用公共状态
  const todayStr = useMemo(() => {
    return getLocalTodayDateStr();
  }, []);

  const [txDate, setTxDate] = useState(todayStr);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 可用卡券列表（基于 stateVersion 感知原地核销状态变化）
  const availableVouchers: Voucher[] = useMemo(() => {
    return engine.state.vouchers.filter((v) => v.status === 'AVAILABLE');
  }, [engine, engine.stateVersion]);

  // --------------------------------------------------------------------------
  // Tab A: 可视化表单状态
  // --------------------------------------------------------------------------
  const [txType, setTxType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [discount, setDiscount] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [holdAmountCnyInput, setHoldAmountCnyInput] = useState('');
  const [fxHoldPct, setFxHoldPct] = useState(() =>
    String(Number((Number(engine.state.fxConfig?.defaultHoldRatio ?? 1.02) * 100).toFixed(1)))
  );
  const [fxCashbackPct, setFxCashbackPct] = useState(() =>
    String(Number((Number(engine.state.fxConfig?.defaultCashbackRate ?? 0.01) * 100).toFixed(2)))
  );

  useEffect(() => {
    setFxHoldPct(
      String(Number((Number(engine.state.fxConfig?.defaultHoldRatio ?? 1.02) * 100).toFixed(1)))
    );
    setFxCashbackPct(
      String(Number((Number(engine.state.fxConfig?.defaultCashbackRate ?? 0.01) * 100).toFixed(2)))
    );
  }, [engine.state.fxConfig?.defaultHoldRatio, engine.state.fxConfig?.defaultCashbackRate]);
  const [targetSelection, setTargetSelection] = useState<{
    type: 'POOL' | 'PROJECT';
    id: string;
  }>(() => {
    const dailyPool =
      engine.state.budgetPools.find(
        (p) => p.is_monthly_budget && p.id === 'POOL_DAILY'
      ) || engine.state.budgetPools.find((p) => p.is_monthly_budget);
    return {
      type: 'POOL',
      id: dailyPool?.id || 'POOL_DAILY',
    };
  });
  const [merchantOrNote, setMerchantOrNote] = useState('');
  const [selectedVoucherIdVisual, setSelectedVoucherIdVisual] = useState<number | null>(null);

  // 当前折算人民币总金额 (用于校验优惠券门槛)
  const currentCnyGross = useMemo(() => {
    const amtNum = Number(amount || 0);
    if (isNaN(amtNum) || amtNum <= 0) return 0;
    if (currency === 'CNY') return amtNum;
    const rate = Number(DEFAULT_FX_RATES[currency] ?? '7.200000');
    return amtNum * rate;
  }, [amount, currency]);

  // 外币预授权冻结金额预估折算
  const estimatedHoldAmount = useMemo(() => {
    if (currency === 'CNY' || !amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0) {
      return '';
    }
    const fxRate = DEFAULT_FX_RATES[currency] ?? '7.200000';
    const ratio = toDecimal(fxHoldPct || '100').dividedBy(100);
    return formatCny(roundCny(toDecimal(amount).times(fxRate).times(ratio)));
  }, [currency, amount, fxHoldPct]);

  // --------------------------------------------------------------------------
  // Tab B: DSL 极客算式状态
  // --------------------------------------------------------------------------
  const [dslInput, setDslInput] = useState('');
  const [selectedVoucherIdDsl, setSelectedVoucherIdDsl] = useState<number | null>(null);

  // 若选中的卡券已被核销或失效，自动清除残留选中值
  useEffect(() => {
    const validIds = new Set(availableVouchers.map((v) => v.id));
    if (selectedVoucherIdVisual != null && !validIds.has(selectedVoucherIdVisual)) {
      setSelectedVoucherIdVisual(null);
    }
    if (selectedVoucherIdDsl != null && !validIds.has(selectedVoucherIdDsl)) {
      setSelectedVoucherIdDsl(null);
    }
  }, [availableVouchers, selectedVoucherIdVisual, selectedVoucherIdDsl]);

  // 实时编译解析 DSL
  const preview = useMemo(() => {
    if (!dslInput.trim()) return null;
    try {
      return engine.previewDsl(dslInput, selectedVoucherIdDsl);
    } catch {
      return null;
    }
  }, [engine, engine.stateVersion, dslInput, selectedVoucherIdDsl]);

  // 成功处理与回调触发
  const triggerSuccess = (msg: string) => {
    setSuccessToast(msg);
    setErrorMsg(null);
    onSuccess?.();
    onRecordSuccess?.();
  };

  // 提交可视化表单记账
  const handleVisualSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0) {
      setErrorMsg('请输入有效的交易金额（大于 0）');
      return;
    }

    try {
      setErrorMsg(null);
      const budgetPoolId =
        targetSelection.type === 'POOL' ? targetSelection.id : undefined;
      const projTagId =
        targetSelection.type === 'PROJECT' ? targetSelection.id : null;

      const noteToSave =
        merchantOrNote.trim() ||
        (txType === 'EXPENSE'
          ? targetSelection.type === 'PROJECT'
            ? engine.state.projectTags.find((t) => t.id === targetSelection.id)?.name || '专项支出'
            : engine.state.budgetPools.find((p) => p.id === targetSelection.id)?.name || '日常消费'
          : '日常收入');

      const tx = engine.recordManualTransaction({
        tx_type: txType,
        tx_date: txDate,
        amount: amount.trim(),
        discount: txType === 'EXPENSE' && discount.trim() ? discount.trim() : '0.00',
        budget_pool_id: budgetPoolId,
        project_tag_id: projTagId,
        merchant_or_note: noteToSave,
        applied_voucher_id:
          txType === 'EXPENSE'
            ? selectedVoucherIdVisual
            : null,
        currency,
        hold_amount_cny: holdAmountCnyInput.trim() || undefined,
        fx_hold_ratio: (Number(fxHoldPct.trim() === '' ? 102 : fxHoldPct) / 100).toFixed(3),
        fx_cashback_rate: (Number(fxCashbackPct.trim() === '' ? 0 : fxCashbackPct) / 100).toFixed(4),
      });

      triggerSuccess(
        `✅ 记账成功！实付 ¥${tx.header.total_net}`
      );

      // 表单重置
      setAmount('');
      setDiscount('');
      setMerchantOrNote('');
      setHoldAmountCnyInput('');
      setSelectedVoucherIdVisual(null);
      setFxHoldPct(
        String(Number((Number(engine.state.fxConfig?.defaultHoldRatio ?? 1.02) * 100).toFixed(1)))
      );
      setFxCashbackPct(
        String(Number((Number(engine.state.fxConfig?.defaultCashbackRate ?? 0.01) * 100).toFixed(2)))
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // 提交 DSL 记账
  const handleDslSubmit = () => {
    if (!dslInput.trim()) return;
    try {
      setErrorMsg(null);
      const tx = engine.recordFromDsl(dslInput, txDate, selectedVoucherIdDsl);
      triggerSuccess(
        `✅ 记账成功！实付 ¥${tx.header.total_net}`
      );
      setSelectedVoucherIdDsl(null);
      setDslInput('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // 辅助名称查询
  const getCategoryName = (id?: string) => {
    if (!id) return '-';
    const cat = engine.state.categories.find((c) => c.id === id);
    return cat ? cat.name : id;
  };

  const getPoolName = (id?: string) => {
    if (!id) return '-';
    const p = engine.state.budgetPools.find((b) => b.id === id);
    return p ? p.name : id;
  };

  return (
    <Card sx={{ overflow: 'hidden' }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        {/* 顶部标题栏与工作模式切换胶囊 */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{
            alignItems: { xs: 'stretch', sm: 'center' },
            justifyContent: 'space-between',
            mb: 2.5,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: '12px',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(11, 87, 208, 0.25)',
              }}
            >
              <FlashOnRounded fontSize="small" />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                双模记账工作台
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                支持可视化精准记账与单行多品满减分摊 DSL 算式
              </Typography>
            </Box>
          </Box>

          {/* 双模切换器 */}
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_, val) => val && setMode(val)}
            size="small"
            aria-label="recording mode"
          >
            <ToggleButton value="visual" sx={{ px: 2, gap: 0.5 }}>
              <EditNoteRounded fontSize="small" />
              <span>可视化记账</span>
            </ToggleButton>
            <ToggleButton value="dsl" sx={{ px: 2, gap: 0.5 }}>
              <FlashOnRounded fontSize="small" />
              <span>极速算式记账</span>
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <Divider sx={{ mb: 2.5 }} />

        {/* ------------------------------------------------------------------ */}
        {/* 模式 A：可视化记账表单 (DEFAULT) */}
        {/* ------------------------------------------------------------------ */}
        {mode === 'visual' && (
          <Box component="form" onSubmit={handleVisualSubmit}>
            <Stack spacing={2.5}>
              {/* 交易类型 Toggle */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                  交易类型
                </Typography>
                <ToggleButtonGroup
                  value={txType}
                  exclusive
                  onChange={(_, val) => {
                    if (val) {
                      setTxType(val);
                      setSelectedVoucherIdVisual(null);
                    }
                  }}
                  size="small"
                  sx={{ width: 'fit-content' }}
                >
                  <ToggleButton
                    value="EXPENSE"
                    sx={{
                      px: 2.5,
                      gap: 0.5,
                      '&.Mui-selected': {
                        color: 'error.main',
                        bgcolor: (t) =>
                          t.palette.mode === 'light' ? '#ffebe9' : '#3d1618',
                      },
                    }}
                  >
                    <TrendingDownRounded fontSize="small" />
                    <span>支出</span>
                  </ToggleButton>
                  <ToggleButton
                    value="INCOME"
                    sx={{
                      px: 2.5,
                      gap: 0.5,
                      '&.Mui-selected': {
                        color: 'success.main',
                        bgcolor: (t) =>
                          t.palette.mode === 'light' ? '#e6f4ea' : '#143821',
                      },
                    }}
                  >
                    <TrendingUpRounded fontSize="small" />
                    <span>收入</span>
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>

              {/* 核心金额、立减与日期网格 */}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label={txType === 'INCOME' ? '收入金额' : '交易金额'}
                  type="number"
                  required
                  fullWidth
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  slotProps={{
                    htmlInput: { step: '0.01', min: '0.01' },
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          {currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'JPY' ? 'JP¥' : '¥'}
                        </InputAdornment>
                      ),
                    },
                  }}
                />

                {txType === 'EXPENSE' && (
                  <TextField
                    label="直接满减/立减（选填）"
                    type="number"
                    fullWidth
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    placeholder="0.00"
                    slotProps={{
                      htmlInput: { step: '0.01', min: '0' },
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">-¥</InputAdornment>
                        ),
                      },
                    }}
                    helperText={
                      amount && discount
                        ? `预估实付: ¥${Math.max(
                            0,
                            Number(amount || 0) - Number(discount || 0)
                          ).toFixed(2)}`
                        : undefined
                    }
                  />
                )}

                <TextField
                  label="记账日期"
                  type="date"
                  fullWidth
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />

                {txType === 'EXPENSE' && (
                  <TextField
                    select
                    label="币种"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    sx={{ minWidth: 100 }}
                  >
                    <MenuItem value="CNY">CNY 人民币</MenuItem>
                    <MenuItem value="USD">USD 美元</MenuItem>
                    <MenuItem value="EUR">EUR 欧元</MenuItem>
                    <MenuItem value="JPY">JPY 日元</MenuItem>
                  </TextField>
                )}
              </Stack>

              {/* 外币预授权与返现参数 */}
              {txType === 'EXPENSE' && currency !== 'CNY' && (
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      label="预授权冻结人民币 (CNY，选填)"
                      type="number"
                      fullWidth
                      value={holdAmountCnyInput}
                      onChange={(e) => setHoldAmountCnyInput(e.target.value)}
                      placeholder={estimatedHoldAmount ? `预估约 ¥${estimatedHoldAmount}` : '0.00'}
                      slotProps={{
                        htmlInput: { step: '0.01', min: '0.01' },
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">¥</InputAdornment>
                          ),
                        },
                      }}
                      helperText={
                        estimatedHoldAmount
                          ? `未填则按参考汇率自动折算预估冻结约 ¥${estimatedHoldAmount}`
                          : '未填则按参考汇率与冻结比例自动折算'
                      }
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      label="预授权冻结比例 (%)"
                      type="number"
                      fullWidth
                      value={fxHoldPct}
                      onChange={(e) => setFxHoldPct(e.target.value)}
                      placeholder="102"
                      slotProps={{
                        htmlInput: { step: '0.1', min: '100' },
                        input: {
                          endAdornment: (
                            <InputAdornment position="end">%</InputAdornment>
                          ),
                        },
                      }}
                      helperText="预估折算冻结比例（如 102% 或 100%）"
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      label="外币返现比例 (%)"
                      type="number"
                      fullWidth
                      value={fxCashbackPct}
                      onChange={(e) => setFxCashbackPct(e.target.value)}
                      placeholder="1"
                      slotProps={{
                        htmlInput: { step: '0.01', min: '0' },
                        input: {
                          endAdornment: (
                            <InputAdornment position="end">%</InputAdornment>
                          ),
                        },
                      }}
                      helperText="预授权及清算时返现比例（如 1%）"
                    />
                  </Grid>
                </Grid>
              )}

              {/* 消费备注 */}
              <TextField
                label="商户或消费备注"
                fullWidth
                value={merchantOrNote}
                onChange={(e) => setMerchantOrNote(e.target.value)}
                placeholder={
                  txType === 'EXPENSE'
                    ? '如：肯德基疯狂星期四 / 超市零食 / 打印费'
                    : '如：生活费汇款 / 兼职收入 / 奖学金'
                }
              />

              {/* 支出专属：支出归属（选择资金池或专项） */}
              {txType === 'EXPENSE' && (
                <Box>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 600,
                      color: 'text.secondary',
                      display: 'block',
                      mb: 1,
                    }}
                  >
                    支出归属（选择资金池或专项）
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {engine.state.budgetPools
                      .filter((p) => p.is_monthly_budget)
                      .map((pool) => {
                        const isSelected =
                          targetSelection.type === 'POOL' &&
                          targetSelection.id === pool.id;
                        return (
                          <Chip
                            key={pool.id}
                            label={`💰 ${pool.name}`}
                            clickable
                            color={isSelected ? 'primary' : 'default'}
                            variant={isSelected ? 'filled' : 'outlined'}
                            onClick={() =>
                              setTargetSelection({ type: 'POOL', id: pool.id })
                            }
                            sx={{
                              fontWeight: isSelected ? 700 : 500,
                              borderWidth: 1,
                            }}
                          />
                        );
                      })}

                    {engine.state.projectTags
                      .filter((tag) => tag.is_active !== false)
                      .map((tag) => {
                        const isSelected =
                          targetSelection.type === 'PROJECT' &&
                          targetSelection.id === tag.id;
                        return (
                          <Chip
                            key={tag.id}
                            label={`🎯 ${tag.name}`}
                            clickable
                            color="secondary"
                            variant={isSelected ? 'filled' : 'outlined'}
                            onClick={() =>
                              setTargetSelection({
                                type: 'PROJECT',
                                id: tag.id,
                              })
                            }
                            sx={{
                              fontWeight: isSelected ? 700 : 500,
                              borderWidth: 1,
                            }}
                          />
                        );
                      })}
                  </Box>
                </Box>
              )}

              {/* 支出专属：核销虚拟卡包立减金 */}
              {txType === 'EXPENSE' && (
                <TextField
                  select
                  fullWidth
                  label="核销虚拟卡包立减金 (可选)"
                  value={selectedVoucherIdVisual ?? ''}
                  onChange={(e) =>
                    setSelectedVoucherIdVisual(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                >
                  <MenuItem value="">(不使用卡券 / 纯原价实付)</MenuItem>
                  {availableVouchers.map((v) => {
                      const isUnderMinSpend =
                        currentCnyGross > 0 &&
                        currentCnyGross < Number(v.min_spend);
                      return (
                        <MenuItem
                          key={v.id}
                          value={v.id}
                          disabled={isUnderMinSpend}
                        >
                          {v.title} · 面值 ¥{v.face_value} (成本 ¥{v.acquire_cost} / 门槛 ¥
                          {v.min_spend})
                          {isUnderMinSpend ? `（未满 ¥${v.min_spend} 门槛）` : ''}
                        </MenuItem>
                      );
                    })}
                </TextField>
              )}

              {/* 外币提示 */}
              {txType === 'EXPENSE' && currency !== 'CNY' && (
                <Alert severity="info" sx={{ borderRadius: 3 }}>
                  <strong>外币预授权提示：</strong>已选择 {currency}{' '}
                  币种。记账后将按 {fxHoldPct || 100}% 预授权冻结挂起（预估返现{' '}
                  {fxCashbackPct || 0}%），待银行正式出账后输入最终人民币金额即可完成清算。
                </Alert>
              )}

              {/* 提交入账按钮 */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="large"
                  startIcon={<CheckRounded />}
                  sx={{ px: 4, py: 1.2, fontSize: '0.95rem' }}
                >
                  立即入账
                </Button>
              </Box>
            </Stack>
          </Box>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* 模式 B：极速算式 DSL (Geek Formula Mode) */}
        {/* ------------------------------------------------------------------ */}
        {mode === 'dsl' && (
          <Stack spacing={2}>
            {/* 日期选择 */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                记账日期:
              </Typography>
              <TextField
                type="date"
                size="small"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                sx={{ width: 160 }}
              />
            </Box>

            {/* 核心单行 DSL 命令输入框 */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                gap: 1.5,
                alignItems: 'stretch',
              }}
            >
              <TextField
                fullWidth
                value={dslInput}
                onChange={(e) => {
                  setDslInput(e.target.value);
                  setErrorMsg(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleDslSubmit();
                  }
                }}
                placeholder="输入记账算式，如：午饭 15+3 = 16 #高频饮食  或  Gemini会员 JPY 720"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Typography
                          sx={{
                            fontFamily: 'Consolas, "Cascadia Code", "Microsoft YaHei", monospace',
                            fontWeight: 700,
                            color: 'primary.main',
                          }}
                        >
                          ❯_
                        </Typography>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <Button
                variant="contained"
                color="primary"
                onClick={handleDslSubmit}
                startIcon={<CheckRounded />}
                sx={{ minWidth: 120, py: 1.2 }}
              >
                立即入账
              </Button>
            </Box>

            {/* 外币符号自动置顶感知 */}
            {preview?.is_fx_detected && (
              <Alert severity="info" sx={{ borderRadius: 3 }}>
                <strong>外币消费自动感知：</strong>已识别外币消费（自动启用预授权冻结挂起与返现核算）
              </Alert>
            )}

            {/* 叠加立减金选择器 */}
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{
                justifyContent: 'space-between',
                alignItems: { sm: 'center' },
              }}
            >
              <TextField
                select
                size="small"
                label="🎟️ 虚拟卡包立减金叠加核销"
                value={selectedVoucherIdDsl ?? ''}
                onChange={(e) =>
                  setSelectedVoucherIdDsl(
                    e.target.value ? Number(e.target.value) : null
                  )
                }
                sx={{ minWidth: 260 }}
              >
                <MenuItem value="">(不使用卡券 / 纯现金原价实付)</MenuItem>
                {availableVouchers.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    {v.title} · 面值 ¥{v.face_value} (成本 ¥{v.acquire_cost} / 门槛 ¥
                    {v.min_spend})
                  </MenuItem>
                ))}
              </TextField>

              {preview?.voucherInfo && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    结转成本: ¥{preview.voucherInfo.acquire_cost}
                  </Typography>
                  <Chip
                    size="small"
                    color="success"
                    icon={<LocalOfferRounded />}
                    label={`净省 ¥${preview.voucherSavings}`}
                  />
                </Stack>
              )}
            </Stack>

            {/* 实时解析与多品分摊预览表 */}
            {preview && preview.parsed && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 3,
                  bgcolor: (t) =>
                    t.palette.mode === 'light' ? '#fafbff' : '#141a24',
                }}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: { sm: 'center' },
                    mb: 1.5,
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 700, color: 'secondary.main' }}
                  >
                    📊 拆单与满减分摊实时预览（分摊模式: {preview.parsed.allocation_mode === 'PROPORTIONAL' ? '等比分摊' : preview.parsed.allocation_mode === 'PRIMARY_ITEM' ? '主商品抵扣' : '单一分摊'}）
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2, fontSize: '0.85rem' }}>
                    <span>
                      原价: <strong>¥{preview.parsed.total_gross}</strong>
                    </span>
                    <span style={{ color: '#146c2e' }}>
                      优惠: -<strong>¥{preview.parsed.payment_discount || preview.parsed.platform_discount}</strong>
                    </span>
                    <span style={{ color: '#0b57d0' }}>
                      实付: <strong>¥{preview.parsed.total_net}</strong>
                    </span>
                  </Box>
                </Stack>

                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>商品/明细子项</TableCell>
                        <TableCell align="right">原价/算式</TableCell>
                        <TableCell align="right">分摊优惠</TableCell>
                        <TableCell align="right">实付净额</TableCell>
                        <TableCell>归属预算池</TableCell>
                        <TableCell>专项标签</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {preview.parsed.items.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {item.item_name}
                              </Typography>
                              {item.is_primary_item && preview.parsed.items.length > 1 && (
                                <Chip
                                  size="small"
                                  label="主商品"
                                  color="secondary"
                                  sx={{ height: 18, fontSize: '0.65rem' }}
                                />
                              )}
                            </Box>
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2">¥{item.item_gross}</Typography>
                            {item.raw_formula_expr &&
                              item.raw_formula_expr !== item.item_gross && (
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: 'text.secondary',
                                    fontFamily: 'Consolas, "Cascadia Code", "Microsoft YaHei", monospace',
                                  }}
                                >
                                  ({item.raw_formula_expr})
                                </Typography>
                              )}
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'success.main' }}>
                            -¥{item.allocated_discount}
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              ¥{item.item_net}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={getPoolName(item.budget_pool_id)}
                              variant="outlined"
                              sx={{ height: 22, fontSize: '0.75rem' }}
                            />
                          </TableCell>
                          <TableCell>
                            {item.project_tag_id ? (
                              <Chip
                                size="small"
                                label={`#${item.project_tag_id}`}
                                color="info"
                                variant="outlined"
                                sx={{ height: 22, fontSize: '0.75rem' }}
                              />
                            ) : (
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                -
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}
          </Stack>
        )}

        {/* 统一反馈提示 */}
        {errorMsg && (
          <Alert severity="error" sx={{ mt: 2, borderRadius: 3 }}>
            {errorMsg}
          </Alert>
        )}

        <Snackbar
          open={!!successToast}
          autoHideDuration={3500}
          onClose={() => setSuccessToast(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            onClose={() => setSuccessToast(null)}
            severity="success"
            variant="filled"
            sx={{ width: '100%', borderRadius: 3, fontWeight: 600 }}
          >
            {successToast}
          </Alert>
        </Snackbar>
      </CardContent>
    </Card>
  );
};
