import React, { useState, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  TextField,
  MenuItem,
  Button,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Alert,
  Snackbar,
  Collapse,
  Paper,
  InputAdornment,
} from '@mui/material';
import EditRounded from '@mui/icons-material/EditRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import TrendingDownRounded from '@mui/icons-material/TrendingDownRounded';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { LocalLedgerEngine } from '../sync/local-replica';
import { TransactionAggregate } from '@ledger/core';

export interface TransactionsViewProps {
  engine: LocalLedgerEngine;
  onOpenQuickRecord?: () => void;
}

export const TransactionsView: React.FC<TransactionsViewProps> = ({
  engine,
  onOpenQuickRecord,
}) => {
  // --------------------------------------------------------------------------
  // 筛选状态
  // --------------------------------------------------------------------------
  const [keyword, setKeyword] = useState('');
  const [monthFilter, setMonthFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [accountFilter, setAccountFilter] = useState<string>('ALL');
  const [poolOrProjectFilter, setPoolOrProjectFilter] = useState<string>('ALL');

  // 展开子项折叠状态 (按 tx.header.id 记录)
  const [expandedTxs, setExpandedTxs] = useState<Record<string, boolean>>({});

  // 消息提示
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // --------------------------------------------------------------------------
  // 编辑弹窗状态
  // --------------------------------------------------------------------------
  const [editingTx, setEditingTx] = useState<TransactionAggregate | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editTargetSelection, setEditTargetSelection] = useState<string>('');
  const [editGross, setEditGross] = useState('');
  const [editDiscount, setEditDiscount] = useState('');

  // --------------------------------------------------------------------------
  // 删除确认弹窗状态
  // --------------------------------------------------------------------------
  const [deletingTxId, setDeletingTxId] = useState<string | null>(null);

  // 提取所有涉及的月份选项
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    engine.state.transactions.forEach((tx) => {
      if (!tx.header.is_deleted && tx.header.tx_date) {
        set.add(tx.header.tx_date.slice(0, 7));
      }
    });
    return Array.from(set).sort().reverse();
  }, [engine.state.transactions]);

  // 筛选过滤
  const filteredTransactions = useMemo(() => {
    return engine.state.transactions.filter((tx) => {
      const h = tx.header;
      if (h.is_deleted) return false;

      // 1. 关键字匹配（备注、原始输入、拆分子项名称）
      if (keyword.trim()) {
        const kw = keyword.trim().toLowerCase();
        const noteMatch = (h.merchant_or_note || '').toLowerCase().includes(kw);
        const rawMatch = (h.raw_input_text || '').toLowerCase().includes(kw);
        const itemMatch = tx.items.some((it) =>
          it.item_name.toLowerCase().includes(kw)
        );
        if (!noteMatch && !rawMatch && !itemMatch) return false;
      }

      // 2. 月份过滤
      if (monthFilter !== 'ALL') {
        if (!h.tx_date.startsWith(monthFilter)) return false;
      }

      // 3. 交易类型过滤
      if (typeFilter !== 'ALL') {
        if (typeFilter === 'EXPENSE') {
          if (h.tx_type !== 'EXPENSE' && h.tx_type !== 'VOUCHER_BUY') return false;
        } else if (h.tx_type !== typeFilter) return false;
      }

      // 4. 账户过滤
      if (accountFilter !== 'ALL') {
        if (h.account_id !== accountFilter && h.target_account_id !== accountFilter) {
          return false;
        }
      }

      // 5. 归属资金池 / 专项过滤
      if (poolOrProjectFilter !== 'ALL') {
        if (poolOrProjectFilter.startsWith('POOL:')) {
          const poolId = poolOrProjectFilter.slice(5);
          const match = tx.items.some(
            (it) => it.budget_pool_id === poolId && !it.project_tag_id
          );
          if (!match) return false;
        } else if (poolOrProjectFilter.startsWith('PROJECT:')) {
          const tagId = poolOrProjectFilter.slice(8);
          const match = tx.items.some((it) => it.project_tag_id === tagId);
          if (!match) return false;
        }
      }

      return true;
    });
  }, [
    engine.state.transactions,
    keyword,
    monthFilter,
    typeFilter,
    accountFilter,
    poolOrProjectFilter,
  ]);

  // 统计信息条
  const summaryStrip = useMemo(() => {
    let totalExpense = 0;
    let totalIncome = 0;
    let totalDiscount = 0;

    for (const tx of filteredTransactions) {
      const h = tx.header;
      if (h.tx_type === 'EXPENSE' || h.tx_type === 'VOUCHER_BUY') {
        totalExpense += Number(h.total_net);
        const discountVal =
          Number(h.payment_discount) > 0
            ? Number(h.payment_discount)
            : Number(h.platform_discount);
        totalDiscount += Number.isFinite(discountVal) && discountVal > 0 ? discountVal : 0;
      } else if (h.tx_type === 'INCOME') {
        totalIncome += Number(h.total_net);
      }
    }

    return {
      count: filteredTransactions.length,
      totalExpense,
      totalIncome,
      totalDiscount,
    };
  }, [filteredTransactions]);

  // 清空筛选
  const handleResetFilters = () => {
    setKeyword('');
    setMonthFilter('ALL');
    setTypeFilter('ALL');
    setAccountFilter('ALL');
    setPoolOrProjectFilter('ALL');
  };

  // 展开/收起子项
  const toggleExpand = (id: string) => {
    setExpandedTxs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // 打开编辑弹窗
  const handleOpenEdit = (tx: TransactionAggregate) => {
    setEditingTx(tx);
    const h = tx.header;
    setEditDate(h.tx_date);
    setEditNote(h.merchant_or_note || h.raw_input_text || '');
    setEditAccountId(h.account_id);
    setEditGross(h.total_gross);
    setEditDiscount(
      Number(h.payment_discount) > 0 ? h.payment_discount : h.platform_discount
    );

    const primaryItem = tx.items[0];
    if (primaryItem?.project_tag_id) {
      setEditTargetSelection(`PROJECT:${primaryItem.project_tag_id}`);
    } else if (primaryItem?.budget_pool_id) {
      setEditTargetSelection(`POOL:${primaryItem.budget_pool_id}`);
    } else {
      setEditTargetSelection('POOL:POOL_DAILY');
    }
  };

  // 保存编辑
  const handleSaveEdit = () => {
    if (!editingTx) return;
    if (!editGross || isNaN(Number(editGross)) || Number(editGross) <= 0) {
      alert('请输入有效的金额');
      return;
    }

    try {
      let poolId: string | undefined = undefined;
      let projId: string | null = null;
      if (editTargetSelection.startsWith('PROJECT:')) {
        projId = editTargetSelection.slice(8);
        const pt = engine.state.projectTags.find((p) => p.id === projId);
        poolId = pt?.linked_pool_id || 'POOL_FUND';
      } else if (editTargetSelection.startsWith('POOL:')) {
        poolId = editTargetSelection.slice(5);
        projId = null;
      }

      engine.updateTransaction(editingTx.header.id, {
        tx_date: editDate,
        merchant_or_note: editNote.trim(),
        account_id: editAccountId,
        total_gross: editGross.trim(),
        payment_discount: editDiscount.trim() || '0.00',
        budget_pool_id: poolId,
        project_tag_id: projId,
      });

      setToastMsg(`✅ 账单 ${editingTx.header.id} 已成功更新！`);
      setEditingTx(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // 执行删除
  const handleConfirmDelete = () => {
    if (!deletingTxId) return;
    try {
      engine.deleteTransaction(deletingTxId);
      setToastMsg(`🗑️ 账单 ${deletingTxId} 已成功删除，相关账户余额与优惠券已回退！`);
      setDeletingTxId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  // 辅助查找
  const getCategoryName = (id?: string) => {
    if (!id) return '-';
    const c = engine.state.categories.find((cat) => cat.id === id);
    return c ? c.name : id;
  };

  const getPoolName = (id?: string) => {
    if (!id) return '-';
    const p = engine.state.budgetPools.find((b) => b.id === id);
    return p ? p.name : id;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* 顶部标题与筛选面板 */}
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{
              justifyContent: 'space-between',
              alignItems: { xs: 'stretch', sm: 'center' },
              mb: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '10px',
                  bgcolor: (t) =>
                    t.palette.mode === 'light' ? '#eef2fd' : '#1e283d',
                  color: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ReceiptLongRounded fontSize="small" />
              </Box>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                  账单明细与全生命周期管理
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  支持多维组合检索、子项拆单追溯、双轨重算与账目原子级回退
                </Typography>
              </Box>
            </Box>

            {onOpenQuickRecord && (
              <Button
                variant="contained"
                color="primary"
                onClick={onOpenQuickRecord}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                + 快速记一笔
              </Button>
            )}
          </Stack>

          {/* 筛选控件组 */}
          <Stack spacing={1.5}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              {/* 关键词搜索 */}
              <TextField
                size="small"
                fullWidth
                placeholder="搜索商户名、备注、算式或商品明细..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRounded fontSize="small" sx={{ color: 'text.secondary' }} />
                      </InputAdornment>
                    ),
                  },
                }}
              />

              {/* 月份筛选 */}
              <TextField
                select
                size="small"
                label="月份筛选"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                sx={{ minWidth: { xs: '100%', md: 150 } }}
              >
                <MenuItem value="ALL">全部月份</MenuItem>
                {availableMonths.map((m) => (
                  <MenuItem key={m} value={m}>
                    {m}
                  </MenuItem>
                ))}
              </TextField>

              {/* 交易类型筛选 */}
              <TextField
                select
                size="small"
                label="交易类型"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                sx={{ minWidth: { xs: '100%', md: 140 } }}
              >
                <MenuItem value="ALL">全部类型</MenuItem>
                <MenuItem value="EXPENSE">支出</MenuItem>
                <MenuItem value="INCOME">收入</MenuItem>
                <MenuItem value="VOUCHER_BUY">购券支出</MenuItem>
              </TextField>

              {/* 归属资金池 / 专项筛选 */}
              <TextField
                select
                size="small"
                label="归属资金池 / 专项筛选"
                value={poolOrProjectFilter}
                onChange={(e) => setPoolOrProjectFilter(e.target.value)}
                sx={{ minWidth: { xs: '100%', md: 200 } }}
              >
                <MenuItem value="ALL">全部资金池与专项</MenuItem>
                {engine.state.budgetPools
                  .filter((p) => p.is_monthly_budget)
                  .map((pool) => (
                    <MenuItem key={pool.id} value={`POOL:${pool.id}`}>
                      💰 {pool.name}
                    </MenuItem>
                  ))}
                {engine.state.projectTags.map((tag) => (
                  <MenuItem key={tag.id} value={`PROJECT:${tag.id}`}>
                    🎯 {tag.name}
                  </MenuItem>
                ))}
              </TextField>

              {/* 重置筛选 */}
              <Button
                variant="outlined"
                color="inherit"
                size="small"
                onClick={handleResetFilters}
                startIcon={<RestartAltRounded />}
                sx={{ minWidth: 100 }}
              >
                重置
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* 统计指标带 */}
      <Paper
        elevation={0}
        sx={{
          p: 1.5,
          borderRadius: 3,
          bgcolor: (t) =>
            t.palette.mode === 'light' ? '#edf2fa' : '#1a2230',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            当前筛选结果：
          </Typography>
          <Chip
            size="small"
            label={`${summaryStrip.count} 笔交易`}
            color="primary"
            variant="filled"
          />
        </Stack>

        <Stack direction="row" spacing={3} sx={{ alignItems: 'center', fontSize: '0.875rem' }}>
          <Typography variant="body2">
            总支出:{' '}
            <strong style={{ color: '#ba1a1a', fontFamily: 'monospace' }}>
              ¥{summaryStrip.totalExpense.toFixed(2)}
            </strong>
          </Typography>
          <Typography variant="body2">
            总收入:{' '}
            <strong style={{ color: '#146c2e', fontFamily: 'monospace' }}>
              +¥{summaryStrip.totalIncome.toFixed(2)}
            </strong>
          </Typography>
          {summaryStrip.totalDiscount > 0 && (
            <Typography variant="body2">
              分摊省钱:{' '}
              <strong style={{ color: '#0b57d0', fontFamily: 'monospace' }}>
                ¥{summaryStrip.totalDiscount.toFixed(2)}
              </strong>
            </Typography>
          )}
        </Stack>
      </Paper>

      {/* 交易列表 */}
      {filteredTransactions.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 8 }}>
            <Typography variant="body1" sx={{ color: 'text.secondary', mb: 1 }}>
              未找到符合条件的账单流水记录
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
              可尝试调整上方筛选条件或点击重置按钮
            </Typography>
            <Button variant="outlined" size="small" onClick={handleResetFilters}>
              重置筛选条件
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {filteredTransactions.map((tx) => {
            const h = tx.header;
            const isExpense = h.tx_type === 'EXPENSE';
            const isIncome = h.tx_type === 'INCOME';
            const isTransfer = h.tx_type === 'TRANSFER';
            const isVoucherBuy = h.tx_type === 'VOUCHER_BUY';
            const isExpenseLike = isExpense || isVoucherBuy;
            const isExpanded = !!expandedTxs[h.id];
            const hasMultipleItems = tx.items.length > 1;

            return (
              <Card key={h.id} sx={{ transition: 'box-shadow 0.2s', '&:hover': { boxShadow: 2 } }}>
                <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={2}
                    sx={{
                      alignItems: { xs: 'flex-start', md: 'center' },
                      justifyContent: 'space-between',
                    }}
                  >
                    {/* 左侧：类型图标、标题、分类、账户 */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flex: 1 }}>
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: isExpenseLike
                            ? (t) =>
                                t.palette.mode === 'light' ? '#ffebe9' : '#3d1618'
                            : isIncome
                            ? (t) =>
                                t.palette.mode === 'light' ? '#e6f4ea' : '#143821'
                            : (t) =>
                                t.palette.mode === 'light' ? '#e0f7fa' : '#00363d',
                          color: isExpenseLike
                            ? 'error.main'
                            : isIncome
                            ? 'success.main'
                            : 'secondary.main',
                          flexShrink: 0,
                          mt: 0.3,
                        }}
                      >
                        {isExpenseLike ? (
                          <TrendingDownRounded fontSize="small" />
                        ) : isIncome ? (
                          <TrendingUpRounded fontSize="small" />
                        ) : (
                          <SwapHorizRounded fontSize="small" />
                        )}
                      </Box>

                      <Box sx={{ flex: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {h.merchant_or_note || h.raw_input_text}
                          </Typography>

                          {/* 交易类型胶囊 */}
                          <Chip
                            size="small"
                            label={
                              isVoucherBuy
                                ? '购券支出'
                                : isExpense
                                ? '支出'
                                : isIncome
                                ? '收入'
                                : '转账'
                            }
                            color={
                              isVoucherBuy
                                ? 'primary'
                                : isExpense
                                ? 'error'
                                : isIncome
                                ? 'success'
                                : 'secondary'
                            }
                            sx={{ height: 20, fontSize: '0.7rem', fontWeight: 600 }}
                          />

                          {/* 支出归属胶囊 */}
                          {isExpenseLike && (
                            tx.items[0]?.project_tag_id ? (
                              <Chip
                                size="small"
                                color="secondary"
                                label={`🎯 ${engine.state.projectTags.find((p) => p.id === tx.items[0]?.project_tag_id)?.name || tx.items[0].project_tag_id}`}
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            ) : tx.items[0]?.budget_pool_id ? (
                              <Chip
                                size="small"
                                label={`💰 ${getPoolName(tx.items[0].budget_pool_id)}`}
                                variant="outlined"
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            ) : tx.items[0]?.category_id ? (
                              <Chip
                                size="small"
                                label={getCategoryName(tx.items[0].category_id)}
                                variant="outlined"
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            ) : null
                          )}

                          {/* 立减金使用标记 */}
                          {h.applied_voucher_id != null && (
                            <Chip
                              size="small"
                              label={h.tx_type === 'TRANSFER' ? '🎟️ 已用还款券' : '🎟️ 已用立减金'}
                              color="success"
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          )}

                          {/* 清算状态标记 */}
                          {h.settlement_status === 'PENDING_HOLD' ? (
                            <Chip
                              size="small"
                              label={`⏳ 待清算 (冻结 ¥${h.hold_amount_cny})`}
                              color="warning"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          ) : (
                            <Chip
                              size="small"
                              label="已锁定"
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.7rem', color: 'text.secondary' }}
                            />
                          )}
                        </Box>

                        {/* 次级信息行：日期 · 账户流水链路 · 专项标签 */}
                        <Typography
                          variant="caption"
                          sx={{
                            color: 'text.secondary',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            mt: 0.5,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span style={{ fontFamily: 'monospace' }}>{h.tx_date}</span>
                          {tx.items[0]?.project_tag_id && (
                            <>
                              <span>·</span>
                              <span style={{ color: '#7c4dff', fontWeight: 600 }}>
                                🎯 {engine.state.projectTags.find((p) => p.id === tx.items[0].project_tag_id)?.name || tx.items[0].project_tag_id}
                              </span>
                            </>
                          )}
                        </Typography>

                        {/* 原始 DSL / 算式输入提示 */}
                        {h.raw_input_text &&
                          h.raw_input_text !== h.merchant_or_note && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: 'text.secondary',
                                fontFamily: 'monospace',
                                display: 'block',
                                mt: 0.3,
                                bgcolor: (t) =>
                                  t.palette.mode === 'light' ? '#f5f7fb' : '#141a24',
                                px: 1,
                                py: 0.2,
                                borderRadius: 1,
                                width: 'fit-content',
                              }}
                            >
                              ❯_ {h.raw_input_text}
                            </Typography>
                          )}
                      </Box>
                    </Box>

                    {/* 右侧：金额呈现与操作按钮 */}
                    <Stack
                      direction="row"
                      spacing={2}
                      sx={{
                        alignItems: 'center',
                        justifyContent: { xs: 'space-between', md: 'flex-end' },
                        width: { xs: '100%', md: 'auto' },
                        pt: { xs: 1, md: 0 },
                        borderTop: { xs: '1px dashed rgba(0,0,0,0.06)', md: 'none' },
                      }}
                    >
                      {/* 金额拆解 */}
                      <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                        <Typography
                          variant="h6"
                          sx={{
                            fontWeight: 800,
                            fontFamily: 'monospace',
                            lineHeight: 1.1,
                            color: isExpenseLike
                              ? 'text.primary'
                              : isIncome
                              ? 'success.main'
                              : 'secondary.main',
                          }}
                        >
                          {isExpenseLike ? `-¥${h.total_net}` : isIncome ? `+¥${h.total_net}` : `¥${h.total_net}`}
                        </Typography>

                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{
                            justifyContent: { xs: 'flex-start', md: 'flex-end' },
                            fontSize: '0.75rem',
                            mt: 0.3,
                          }}
                        >
                          {Number(h.total_gross) !== Number(h.total_net) && (
                            <span style={{ color: '#888', textDecoration: 'line-through' }}>
                              ¥{h.total_gross}
                            </span>
                          )}
                          {(Number(h.payment_discount) > 0 ||
                            Number(h.platform_discount) > 0) && (
                            <span style={{ color: '#146c2e', fontWeight: 600 }}>
                              省 ¥{Number(h.payment_discount) > 0 ? h.payment_discount : h.platform_discount}
                            </span>
                          )}
                          {h.original_currency !== 'CNY' && h.original_amount && (
                            <span style={{ color: '#006874', fontWeight: 600 }}>
                              ({h.original_currency} {h.original_amount})
                            </span>
                          )}
                        </Stack>
                      </Box>

                      {/* 操作按钮区 */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {/* 拆单子项展开按钮 */}
                        {hasMultipleItems && (
                          <IconButton
                            size="small"
                            onClick={() => toggleExpand(h.id)}
                            title="查看多品类拆单明细"
                            sx={{ color: 'text.secondary' }}
                          >
                            {isExpanded ? <ExpandLessRounded /> : <ExpandMoreRounded />}
                          </IconButton>
                        )}

                        {/* 编辑按钮 */}
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenEdit(tx)}
                          title="编辑修改账单"
                        >
                          <EditRounded fontSize="small" />
                        </IconButton>

                        {/* 删除按钮 */}
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeletingTxId(h.id)}
                          title="删除账单并回退关联余额"
                        >
                          <DeleteOutlineRounded fontSize="small" />
                        </IconButton>
                      </Box>
                    </Stack>
                  </Stack>

                  {/* 展开的多品类拆单子项明细 */}
                  {hasMultipleItems && (
                    <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                      <Divider sx={{ my: 1.5 }} />
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          bgcolor: (t) =>
                            t.palette.mode === 'light' ? '#f9fafe' : '#141a24',
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 1 }}
                        >
                          📦 单据拆单子项明细 ({tx.items.length} 个子项)
                        </Typography>
                        <Stack spacing={1}>
                          {tx.items.map((it, itemIdx) => (
                            <Box
                              key={itemIdx}
                              sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                py: 0.5,
                                borderBottom:
                                  itemIdx < tx.items.length - 1
                                    ? '1px dashed rgba(0,0,0,0.06)'
                                    : 'none',
                                fontSize: '0.8rem',
                              }}
                            >
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <strong>{it.item_name}</strong>
                                {it.project_tag_id ? (
                                  <Chip
                                    size="small"
                                    color="secondary"
                                    label={`🎯 ${engine.state.projectTags.find((p) => p.id === it.project_tag_id)?.name || it.project_tag_id}`}
                                    sx={{ height: 18, fontSize: '0.65rem' }}
                                  />
                                ) : (
                                  <Chip
                                    size="small"
                                    label={`💰 ${getPoolName(it.budget_pool_id)}`}
                                    variant="outlined"
                                    sx={{ height: 18, fontSize: '0.65rem' }}
                                  />
                                )}
                              </Box>

                              <Box sx={{ textAlign: 'right', fontFamily: 'monospace' }}>
                                <span>原价 ¥{it.item_gross}</span>
                                {Number(it.allocated_discount) > 0 && (
                                  <span style={{ color: '#146c2e', marginLeft: 8 }}>
                                    -¥{it.allocated_discount}
                                  </span>
                                )}
                                <strong style={{ marginLeft: 8 }}>
                                  实付 ¥{it.item_net}
                                </strong>
                              </Box>
                            </Box>
                          ))}
                        </Stack>
                      </Paper>
                    </Collapse>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* 编辑账单 MD3 Dialog 弹窗 */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={!!editingTx}
        onClose={() => setEditingTx(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, pb: 1 }}>
          编辑修改账单 · {editingTx?.header.id}
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2.5 }}>
          <Stack spacing={2}>
            <TextField
              label="记账日期"
              type="date"
              fullWidth
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />

            <TextField
              label="商户名称或消费备注"
              fullWidth
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="原价金额"
                type="number"
                fullWidth
                value={editGross}
                onChange={(e) => setEditGross(e.target.value)}
                slotProps={{
                  htmlInput: { step: '0.01', min: '0.01' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">¥</InputAdornment>
                    ),
                  },
                }}
              />

              <TextField
                label="优惠减免"
                type="number"
                fullWidth
                value={editDiscount}
                onChange={(e) => setEditDiscount(e.target.value)}
                slotProps={{
                  htmlInput: { step: '0.01', min: '0' },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">-¥</InputAdornment>
                    ),
                  },
                }}
                helperText={
                  editGross && editDiscount
                    ? `预估净实付: ¥${Math.max(
                        0,
                        Number(editGross || 0) - Number(editDiscount || 0)
                      ).toFixed(2)}`
                    : undefined
                }
              />
            </Stack>

            {editingTx?.header.tx_type === 'EXPENSE' && (
              <TextField
                select
                label="支出归属（月度资金池 / 专项预算）"
                fullWidth
                value={editTargetSelection}
                onChange={(e) => setEditTargetSelection(e.target.value)}
              >
                <MenuItem disabled value="" sx={{ fontWeight: 700, opacity: 0.7 }}>
                  ── 月度预算资金池 ──
                </MenuItem>
                {engine.state.budgetPools
                  .filter((p) => p.is_monthly_budget)
                  .map((pool) => (
                    <MenuItem key={pool.id} value={`POOL:${pool.id}`}>
                      💰 {pool.name}
                    </MenuItem>
                  ))}
                <MenuItem disabled value="" sx={{ fontWeight: 700, opacity: 0.7 }}>
                  ── 专项预算与心愿单 ──
                </MenuItem>
                {engine.state.projectTags.map((tag) => (
                  <MenuItem key={tag.id} value={`PROJECT:${tag.id}`}>
                    🎯 {tag.name} (目标 ¥{tag.target_budget || '0.00'})
                  </MenuItem>
                ))}
              </TextField>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            variant="text"
            color="inherit"
            onClick={() => setEditingTx(null)}
            startIcon={<CloseRounded />}
          >
            取消
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSaveEdit}
            startIcon={<CheckRounded />}
          >
            保存并重算全账本
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* 删除确认 MD3 Dialog 弹窗 */}
      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={!!deletingTxId}
        onClose={() => setDeletingTxId(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>确认删除此笔交易？</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            单据号: <code>{deletingTxId}</code>
          </Typography>
          <Alert severity="warning" sx={{ borderRadius: 2 }}>
            <strong>自动平衡回退：</strong>
            删除后，该笔交易的扣款将被自动原路返还至账户余额；若本交易使用了虚拟卡包立减金，该券将自动恢复为可用状态（AVAILABLE）。
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            variant="text"
            color="inherit"
            onClick={() => setDeletingTxId(null)}
          >
            取消
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirmDelete}
            startIcon={<DeleteOutlineRounded />}
          >
            确认删除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 消息提示 */}
      <Snackbar
        open={!!toastMsg}
        autoHideDuration={3500}
        onClose={() => setToastMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setToastMsg(null)}
          severity="success"
          variant="filled"
          sx={{ width: '100%', borderRadius: 3, fontWeight: 600 }}
        >
          {toastMsg}
        </Alert>
      </Snackbar>
    </Box>
  );
};
