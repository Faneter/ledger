import React, { useState, useMemo } from 'react';
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
import { Voucher } from '@ledger/core';

export interface QuickInputBarProps {
  engine: LocalLedgerEngine;
  onSuccess?: () => void;
  onRecordSuccess?: () => void;
}

const PRESET_PILLS = [
  {
    label: '场景 1：拌面与饭卡立减',
    dsl: '咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食',
    desc: '单据多品算式计算与自含立减',
  },
  {
    label: '场景 2：跨品类凑单信用卡满减',
    dsl: '牛奶 28 #饮食 + 晾衣架 12 #日用 + 排针 15 #电子 = 50 @招行信用卡',
    desc: '多品类权重等比分摊与最后一分尾差兜底',
  },
  {
    label: '场景 3：万事达外币预授权消费',
    dsl: 'Porkbun域名 $4.35 冻结31.95 #数字服务 @万事达A',
    desc: '自动唤醒外币借记卡 + 102%冻结 + 1%返现',
  },
  {
    label: '场景 4：花呗用券还款',
    dsl: '还款 @花呗 500 - 还款券 5 从 @主力银联卡',
    desc: '信用负债清偿与还款抵扣券核销',
  },
];

export const QuickInputBar: React.FC<QuickInputBarProps> = ({
  engine,
  onSuccess,
  onRecordSuccess,
}) => {
  // 记账模式：'visual' (可视化表单) | 'dsl' (极速算式 DSL)
  const [mode, setMode] = useState<'visual' | 'dsl'>('visual');

  // 通用公共状态
  const todayStr = useMemo(() => {
    return '2026-11-12'; // 严格对齐 PRD 基准日
  }, []);

  const [txDate, setTxDate] = useState(todayStr);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 可用卡券列表
  const availableVouchers: Voucher[] = useMemo(() => {
    return engine.state.vouchers.filter((v) => v.status === 'AVAILABLE');
  }, [engine.state.vouchers]);

  // --------------------------------------------------------------------------
  // Tab A: 可视化表单状态
  // --------------------------------------------------------------------------
  const [txType, setTxType] = useState<'EXPENSE' | 'INCOME' | 'TRANSFER'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [discount, setDiscount] = useState('');
  const [currency, setCurrency] = useState('CNY');
  const [accountId, setAccountId] = useState(() => {
    const defaultAcc = engine.state.accounts.find((a) => a.is_default_pay);
    return defaultAcc?.id || engine.state.accounts[0]?.id || 'ACC_UNION_MAIN';
  });
  const [targetAccountId, setTargetAccountId] = useState(() => {
    const candidate = engine.state.accounts.find((a) => a.account_role === 'CREDIT');
    return candidate?.id || 'ACC_HUABEI';
  });
  const [categoryId, setCategoryId] = useState(() => {
    return engine.state.categories[0]?.id || 'CAT_FOOD';
  });
  const [merchantOrNote, setMerchantOrNote] = useState('');
  const [selectedVoucherIdVisual, setSelectedVoucherIdVisual] = useState<number | null>(null);
  const [projectTagId, setProjectTagId] = useState<string>('');

  // --------------------------------------------------------------------------
  // Tab B: DSL 极客算式状态
  // --------------------------------------------------------------------------
  const [dslInput, setDslInput] = useState(
    '咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食'
  );
  const [selectedVoucherIdDsl, setSelectedVoucherIdDsl] = useState<number | null>(null);

  // 实时编译解析 DSL
  const preview = useMemo(() => {
    if (!dslInput.trim()) return null;
    try {
      return engine.previewDsl(dslInput, selectedVoucherIdDsl);
    } catch {
      return null;
    }
  }, [engine, dslInput, selectedVoucherIdDsl]);

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
    if (txType === 'TRANSFER' && accountId === targetAccountId) {
      setErrorMsg('转账转出与收款账户不能相同');
      return;
    }

    try {
      setErrorMsg(null);
      const noteToSave = merchantOrNote.trim() || (
        txType === 'EXPENSE'
          ? engine.state.categories.find((c) => c.id === categoryId)?.name || '日常消费'
          : txType === 'INCOME'
          ? '日常收入'
          : '内部资金互转'
      );

      const tx = engine.recordManualTransaction({
        tx_type: txType,
        tx_date: txDate,
        account_id: accountId,
        target_account_id: txType === 'TRANSFER' ? targetAccountId : null,
        amount: amount.trim(),
        discount: txType === 'EXPENSE' && discount.trim() ? discount.trim() : '0.00',
        category_id: txType === 'EXPENSE' ? categoryId : undefined,
        project_tag_id: projectTagId ? projectTagId : null,
        merchant_or_note: noteToSave,
        applied_voucher_id: txType === 'EXPENSE' ? selectedVoucherIdVisual : null,
        currency,
      });

      triggerSuccess(
        `✅ 记账成功！单据号: ${tx.header.id}，实付 ¥${tx.header.total_net}`
      );

      // 表单重置
      setAmount('');
      setDiscount('');
      setMerchantOrNote('');
      setSelectedVoucherIdVisual(null);
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
        `✅ 记账成功！单据号: ${tx.header.id}，实付 ¥${tx.header.total_net}`
      );
      setSelectedVoucherIdDsl(null);
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

  const getAccountName = (id?: string) => {
    if (!id) return '-';
    const a = engine.state.accounts.find((acc) => acc.id === id);
    return a ? a.name : id;
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
              <span>极速算式 DSL</span>
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
                  onChange={(_, val) => val && setTxType(val)}
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
                    <span>支出 (EXPENSE)</span>
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
                    <span>收入 (INCOME)</span>
                  </ToggleButton>
                  <ToggleButton
                    value="TRANSFER"
                    sx={{
                      px: 2.5,
                      gap: 0.5,
                      '&.Mui-selected': {
                        color: 'secondary.main',
                        bgcolor: (t) =>
                          t.palette.mode === 'light' ? '#e0f7fa' : '#00363d',
                      },
                    }}
                  >
                    <SwapHorizRounded fontSize="small" />
                    <span>转账/还款 (TRANSFER)</span>
                  </ToggleButton>
                </ToggleButtonGroup>
              </Box>

              {/* 核心金额、立减与日期网格 */}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label={txType === 'TRANSFER' ? '转账金额' : '交易金额 (Gross)'}
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
                    label="优惠/支付立减 (Discount)"
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
                    <MenuItem value="CNY">CNY (人民币)</MenuItem>
                    <MenuItem value="USD">USD (美元)</MenuItem>
                    <MenuItem value="EUR">EUR (欧元)</MenuItem>
                    <MenuItem value="JPY">JPY (日元)</MenuItem>
                  </TextField>
                )}
              </Stack>

              {/* 账户选择与备注 */}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  select
                  fullWidth
                  label={
                    txType === 'INCOME'
                      ? '收款账户'
                      : txType === 'TRANSFER'
                      ? '转出/扣款账户'
                      : '支付/扣款账户'
                  }
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {engine.state.accounts.map((acc) => (
                    <MenuItem key={acc.id} value={acc.id}>
                      {acc.name} · 余额 ¥{acc.book_balance}
                      {acc.account_role === 'CREDIT' ? ' (信用卡/信贷)' : ''}
                    </MenuItem>
                  ))}
                </TextField>

                {txType === 'TRANSFER' && (
                  <TextField
                    select
                    fullWidth
                    label="转入/目标清偿账户"
                    value={targetAccountId}
                    onChange={(e) => setTargetAccountId(e.target.value)}
                  >
                    {engine.state.accounts
                      .filter((acc) => acc.id !== accountId)
                      .map((acc) => (
                        <MenuItem key={acc.id} value={acc.id}>
                          {acc.name} · 余额 ¥{acc.book_balance}
                        </MenuItem>
                      ))}
                  </TextField>
                )}

                <TextField
                  label="商户或消费备注"
                  fullWidth
                  value={merchantOrNote}
                  onChange={(e) => setMerchantOrNote(e.target.value)}
                  placeholder={
                    txType === 'EXPENSE'
                      ? '如：肯德基疯狂星期四 / 超市零食 / 打印费'
                      : txType === 'INCOME'
                      ? '如：生活费汇款 / 兼职收入 / 奖学金'
                      : '如：微信转账到银行卡 / 还花呗'
                  }
                />
              </Stack>

              {/* 支出专属：分类 Chip 选择器 */}
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
                    支出分类选择
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {engine.state.categories.map((cat) => {
                      const isSelected = categoryId === cat.id;
                      return (
                        <Chip
                          key={cat.id}
                          label={cat.name}
                          clickable
                          color={isSelected ? 'primary' : 'default'}
                          variant={isSelected ? 'filled' : 'outlined'}
                          onClick={() => setCategoryId(cat.id)}
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

              {/* 支出专属：优惠券 & 专项/立项标签选择 */}
              {txType === 'EXPENSE' && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
                    {availableVouchers.map((v) => (
                      <MenuItem key={v.id} value={v.id}>
                        {v.title} · 面值 ¥{v.face_value} (成本 ¥{v.acquire_cost} / 门槛 ¥
                        {v.min_spend})
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select
                    fullWidth
                    label="归属跨期专项/心愿单立项 (可选)"
                    value={projectTagId}
                    onChange={(e) => setProjectTagId(e.target.value)}
                  >
                    <MenuItem value="">(无跨期专项 / 归入日常池)</MenuItem>
                    {engine.state.projectTags.map((tag) => (
                      <MenuItem key={tag.id} value={tag.id}>
                        #{tag.name} (目标预算 ¥{tag.target_budget || '0.00'})
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
              )}

              {/* 外币提示 */}
              {currency !== 'CNY' && (
                <Alert severity="info" sx={{ borderRadius: 3 }}>
                  <strong>外币预授权提示：</strong>已选择 {currency}{' '}
                  币种。记账后将自动感知外币借记卡并执行 102%
                  预授权冻结挂起，并在正式账单日前保持 PENDING_HOLD 清算锁定。
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

            {/* 场景胶囊快速载入 */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {PRESET_PILLS.map((pill, idx) => (
                <Chip
                  key={idx}
                  icon={<FlashOnRounded fontSize="small" />}
                  label={pill.label}
                  clickable
                  variant="outlined"
                  onClick={() => {
                    setDslInput(pill.dsl);
                    setErrorMsg(null);
                  }}
                  title={pill.desc}
                  sx={{
                    fontSize: '0.8rem',
                    bgcolor: (t) =>
                      t.palette.mode === 'light' ? '#f5f7fc' : '#1e2533',
                  }}
                />
              ))}
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
                placeholder="输入如: 咸蛋黄拌面 16.8-0.15 + 饭卡充值 20-1.08*3 #饮食 @主力银联卡"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Typography
                          sx={{
                            fontFamily: 'monospace',
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
            {preview?.should_wake_fx_account && (
              <Alert severity="info" sx={{ borderRadius: 3 }}>
                <strong>外币消费自动感知：</strong>已智能唤醒外币借记卡（102%
                预授权冻结挂起 + 1% 返现自动核算）
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
                    📊 拆单与满减分摊实时预览（分摊模式: {preview.parsed.allocation_mode} ·
                    付款账户: {getAccountName(preview.parsed.account_id)}）
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
                        <TableCell>属性分类</TableCell>
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
                                    fontFamily: 'monospace',
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
                              label={getCategoryName(item.category_id)}
                              variant="outlined"
                              sx={{ height: 22, fontSize: '0.75rem' }}
                            />
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
