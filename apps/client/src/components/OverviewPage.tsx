import React, { useState, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Stack,
  Button,
  Chip,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
  Alert,
  TextField,
  InputAdornment,
} from '@mui/material';
import SavingsRounded from '@mui/icons-material/SavingsRounded';
import AccountBalanceWalletRounded from '@mui/icons-material/AccountBalanceWalletRounded';
import LocalOfferRounded from '@mui/icons-material/LocalOfferRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import TrendingDownRounded from '@mui/icons-material/TrendingDownRounded';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded';
import CreditCardRounded from '@mui/icons-material/CreditCardRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import HourglassTopRounded from '@mui/icons-material/HourglassTopRounded';
import { LocalLedgerEngine, DailyBudgetSummary } from '../sync/local-replica';
import { QuickInputBar } from './QuickInputBar';
import { MonthlyBudgetStatusRow, TransactionAggregate } from '@ledger/core';

export interface OverviewPageProps {
  engine: LocalLedgerEngine;
  onNavigate?: (tab: string) => void;
  onOpenQuickRecord?: () => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({
  engine,
  onNavigate,
}) => {
  // 结算输入框状态
  const [settleInputs, setSettleInputs] = useState<Record<string, string>>({});
  const [settleFeedback, setSettleFeedback] = useState<string | null>(null);

  // 1. 日常预算与省钱汇总
  const dailySummary: DailyBudgetSummary = useMemo(() => {
    return engine.getDailyBudgetSummary('2026-11', '2026-11-12');
  }, [engine, engine.state.transactions]);

  // 2. 常规月度预算总览
  const budgetStatuses: MonthlyBudgetStatusRow[] = useMemo(() => {
    return engine.getMonthlyBudgetStatus('2026-11');
  }, [engine, engine.state.transactions]);

  const regularPools = budgetStatuses.filter((b) =>
    ['POOL_FIXED', 'POOL_DAILY', 'POOL_FLEX', 'POOL_EMERGENCY'].includes(b.pool_id)
  );

  const totalMonthlyBudget = regularPools.reduce(
    (acc, cur) => acc + Number(cur.total_available_budget),
    0
  );
  const totalMonthlySpent = regularPools.reduce(
    (acc, cur) => acc + Number(cur.spent_net),
    0
  );
  const usagePercent =
    totalMonthlyBudget > 0
      ? Math.min(100, Math.round((totalMonthlySpent / totalMonthlyBudget) * 100))
      : 0;

  // 3. 净资产计算 (纳入净资产统计的账户)
  const netWorthSummary = useMemo(() => {
    const nwAccounts = engine.state.accounts.filter((a) => a.include_in_networth);
    let totalAssets = 0;
    let totalLiabilities = 0;

    for (const acc of nwAccounts) {
      if (acc.account_role === 'INVESTMENT' && acc.market_value != null) {
        totalAssets += Number(acc.market_value);
      } else {
        const bal = Number(acc.book_balance);
        if (acc.account_role === 'CREDIT') {
          if (bal < 0) totalLiabilities += Math.abs(bal);
          else totalAssets += bal;
        } else {
          if (bal >= 0) totalAssets += bal;
          else totalLiabilities += Math.abs(bal);
        }
      }
    }

    return {
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    };
  }, [engine.state.accounts]);

  // 4. 待清算外币交易
  const pendingFxTxs: TransactionAggregate[] = engine.getPendingFxTransactions();

  // 5. 最近 5 笔交易
  const recentTransactions: TransactionAggregate[] = useMemo(() => {
    return engine.state.transactions
      .filter((tx) => !tx.header.is_deleted)
      .slice(0, 5);
  }, [engine.state.transactions]);

  // 可用立减金数量
  const availableVoucherCount = useMemo(() => {
    return engine.state.vouchers.filter((v) => v.status === 'AVAILABLE').length;
  }, [engine.state.vouchers]);

  // 处理万事达预授权清算
  const handleSettleFx = (txId: string) => {
    const val = settleInputs[txId];
    if (!val || isNaN(Number(val)) || Number(val) <= 0) {
      alert('请输入有效的银行最终正式清算人民币金额（如 31.20）');
      return;
    }

    try {
      engine.settleMastercardPending(txId, val);
      setSettleFeedback(`✅ 外币交易 ${txId} 已成功正式清算入账！实际扣款 ¥${val}`);
      setSettleInputs((prev) => {
        const next = { ...prev };
        delete next[txId];
        return next;
      });
      setTimeout(() => setSettleFeedback(null), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const getAccountName = (id?: string) => {
    if (!id) return '-';
    const a = engine.state.accounts.find((acc) => acc.id === id);
    return a ? a.name : id;
  };

  const getCategoryName = (id?: string) => {
    if (!id) return '-';
    const c = engine.state.categories.find((cat) => cat.id === id);
    return c ? c.name : id;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* 1. 顶部 3 大核心 MD3 概览指标卡 */}
      <Grid container spacing={2.5}>
        {/* 卡片 1: 今日弹性/日常可用日均 */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card
            sx={{
              height: '100%',
              bgcolor: (t) =>
                t.palette.mode === 'light' ? '#ffffff' : '#181e29',
              p: 1,
            }}
          >
            <CardContent>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
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
                  <SavingsRounded fontSize="small" />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    今日日常/弹性可用日均
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: 'primary.main' }}>
                    ¥{dailySummary.dailyAvailableAmount}
                    <Typography
                      component="span"
                      variant="body2"
                      sx={{ ml: 0.5, color: 'text.secondary', fontWeight: 500 }}
                    >
                      / 天
                    </Typography>
                  </Typography>
                </Box>
              </Stack>

              {/* 当月常规预算水位进度条 */}
              <Box sx={{ mt: 2 }}>
                <Stack
                  direction="row"
                  sx={{ justifyContent: 'space-between', mb: 0.5, fontSize: '0.75rem' }}
                >
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    本月已支出 ¥{totalMonthlySpent.toFixed(2)}
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {usagePercent}% (限额 ¥{totalMonthlyBudget.toFixed(2)})
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={usagePercent}
                  color={usagePercent > 90 ? 'error' : usagePercent > 75 ? 'warning' : 'primary'}
                  sx={{ height: 8, borderRadius: 4 }}
                />
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', mt: 0.8, display: 'block', fontSize: '0.72rem' }}
                >
                  距月底还剩 {dailySummary.remainingDays} 天 · 动态平滑无痛自适应
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* 卡片 2: 净资产总览 */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card
            sx={{
              height: '100%',
              bgcolor: (t) =>
                t.palette.mode === 'light' ? '#ffffff' : '#181e29',
              p: 1,
            }}
          >
            <CardContent>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '10px',
                    bgcolor: (t) =>
                      t.palette.mode === 'light' ? '#e0f7fa' : '#00363d',
                    color: 'secondary.main',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AccountBalanceWalletRounded fontSize="small" />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    净资产总览 (Net Worth)
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    ¥{netWorthSummary.netWorth.toFixed(2)}
                  </Typography>
                </Box>
              </Stack>

              {/* 资产与负债拆解 */}
              <Stack
                direction="row"
                spacing={2}
                sx={{
                  mt: 2,
                  p: 1.2,
                  borderRadius: 2,
                  bgcolor: (t) =>
                    t.palette.mode === 'light' ? '#f8f9ff' : '#121721',
                }}
              >
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    总资产 (借记+投资)
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'success.main' }}>
                    ¥{netWorthSummary.totalAssets.toFixed(2)}
                  </Typography>
                </Box>
                <Divider orientation="vertical" flexItem />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    总负债 (信用卡/花呗)
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: 'warning.main' }}>
                    ¥{netWorthSummary.totalLiabilities.toFixed(2)}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* 卡片 3: 本月优惠省钱 & 待办提醒 */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card
            sx={{
              height: '100%',
              bgcolor: (t) =>
                t.palette.mode === 'light' ? '#ffffff' : '#181e29',
              p: 1,
            }}
          >
            <CardContent>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '10px',
                    bgcolor: (t) =>
                      t.palette.mode === 'light' ? '#e6f4ea' : '#143821',
                    color: 'success.main',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <LocalOfferRounded fontSize="small" />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    本月优惠省钱 (Wool)
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: 'success.main' }}>
                    +¥{dailySummary.totalSavedWool}
                  </Typography>
                </Box>
              </Stack>

              {/* 待办与卡包胶囊 */}
              <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
                <Chip
                  size="small"
                  label={`🎟️ 卡包立减金: ${availableVoucherCount} 张可用`}
                  color={availableVoucherCount > 0 ? 'success' : 'default'}
                  variant="outlined"
                  sx={{ fontSize: '0.75rem' }}
                />
                <Chip
                  size="small"
                  label={`⏳ 外币待清算: ${pendingFxTxs.length} 笔`}
                  color={pendingFxTxs.length > 0 ? 'warning' : 'default'}
                  variant={pendingFxTxs.length > 0 ? 'filled' : 'outlined'}
                  sx={{ fontSize: '0.75rem' }}
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* 2. 万事达外币预授权清算置顶横幅 (仅在有待清算外币交易时展示) */}
      {pendingFxTxs.length > 0 && (
        <Card
          sx={{
            borderLeft: '4px solid',
            borderColor: 'warning.main',
            bgcolor: (t) =>
              t.palette.mode === 'light' ? '#fff9f0' : '#292015',
          }}
        >
          <CardContent sx={{ p: 2 }}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{
                alignItems: { xs: 'flex-start', md: 'center' },
                justifyContent: 'space-between',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <HourglassTopRounded color="warning" />
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    外币预授权清算提醒 ({pendingFxTxs.length} 笔挂起中)
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    按 102% 汇率上浮冻结暂扣，收到银行正式扣账账单后可一键核销补退差额并结转返现
                  </Typography>
                </Box>
              </Box>

              <Stack spacing={1} sx={{ width: { xs: '100%', md: 'auto' } }}>
                {pendingFxTxs.map((tx) => (
                  <Stack
                    key={tx.header.id}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    sx={{ alignItems: 'center' }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {tx.header.merchant_or_note || tx.header.raw_input_text} (
                      {tx.header.original_currency} {tx.header.original_amount} · 冻结 ¥
                      {tx.header.hold_amount_cny})
                    </Typography>
                    <TextField
                      size="small"
                      placeholder="实际扣账人民币"
                      value={settleInputs[tx.header.id] || ''}
                      onChange={(e) =>
                        setSettleInputs((prev) => ({
                          ...prev,
                          [tx.header.id]: e.target.value,
                        }))
                      }
                      sx={{ width: 140 }}
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">¥</InputAdornment>
                          ),
                        },
                      }}
                    />
                    <Button
                      size="small"
                      variant="contained"
                      color="warning"
                      onClick={() => handleSettleFx(tx.header.id)}
                      startIcon={<CheckCircleOutlineRounded />}
                    >
                      正式清算
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Stack>

            {settleFeedback && (
              <Alert severity="success" sx={{ mt: 1.5, py: 0.5, borderRadius: 2 }}>
                {settleFeedback}
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* 3. 双模记账工作台 */}
      <Box>
        <QuickInputBar engine={engine} />
      </Box>

      {/* 4. 最近 5 笔流水明细卡片 */}
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CreditCardRounded color="primary" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                最近记账流水
              </Typography>
              <Chip
                size="small"
                label={`${recentTransactions.length} 笔`}
                variant="outlined"
              />
            </Box>

            <Button
              variant="text"
              color="primary"
              endIcon={<ArrowForwardRounded />}
              onClick={() => onNavigate?.('transactions')}
              sx={{ fontWeight: 600 }}
            >
              查看与管理全部账单
            </Button>
          </Stack>

          <Divider sx={{ mb: 1 }} />

          {recentTransactions.length === 0 ? (
            <Typography
              variant="body2"
              sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}
            >
              暂无交易流水。在上方单行记账台输入 DSL 命令或点击快捷胶囊立即记账！
            </Typography>
          ) : (
            <List disablePadding>
              {recentTransactions.map((tx, idx) => {
                const h = tx.header;
                const isExpense = h.tx_type === 'EXPENSE';
                const isIncome = h.tx_type === 'INCOME';
                const isTransfer = h.tx_type === 'TRANSFER';

                return (
                  <React.Fragment key={h.id}>
                    {idx > 0 && <Divider component="li" />}
                    <ListItem
                      sx={{
                        py: 1.5,
                        px: { xs: 1, sm: 2 },
                        display: 'flex',
                        flexDirection: { xs: 'column', sm: 'row' },
                        alignItems: { xs: 'flex-start', sm: 'center' },
                        gap: 1.5,
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <Box
                          sx={{
                            width: 34,
                            height: 34,
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: isExpense
                              ? (t) =>
                                  t.palette.mode === 'light'
                                    ? '#ffebe9'
                                    : '#3d1618'
                              : isIncome
                              ? (t) =>
                                  t.palette.mode === 'light'
                                    ? '#e6f4ea'
                                    : '#143821'
                              : (t) =>
                                  t.palette.mode === 'light'
                                    ? '#e0f7fa'
                                    : '#00363d',
                            color: isExpense
                              ? 'error.main'
                              : isIncome
                              ? 'success.main'
                              : 'secondary.main',
                          }}
                        >
                          {isExpense ? (
                            <TrendingDownRounded fontSize="small" />
                          ) : isIncome ? (
                            <TrendingUpRounded fontSize="small" />
                          ) : (
                            <SwapHorizRounded fontSize="small" />
                          )}
                        </Box>
                      </ListItemIcon>

                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {h.merchant_or_note || h.raw_input_text}
                            </Typography>
                            {isExpense && (
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
                                  label={`💰 ${engine.state.budgetPools.find((p) => p.id === tx.items[0]?.budget_pool_id)?.name || tx.items[0].budget_pool_id}`}
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
                            {h.applied_voucher_id != null && (
                              <Chip
                                size="small"
                                label="🎟️ 券"
                                color="success"
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            )}
                            {h.settlement_status === 'PENDING_HOLD' && (
                              <Chip
                                size="small"
                                label="⏳ 待清算"
                                color="warning"
                                sx={{ height: 20, fontSize: '0.7rem' }}
                              />
                            )}
                          </Box>
                        }
                        secondary={
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', display: 'flex', gap: 1, mt: 0.3 }}
                          >
                            <span>{h.tx_date}</span>
                            <span>·</span>
                            <span>
                              {getAccountName(h.account_id)}
                              {h.target_account_id
                                ? ` ➜ ${getAccountName(h.target_account_id)}`
                                : ''}
                            </span>
                          </Typography>
                        }
                      />

                      <Box
                        sx={{
                          textAlign: { xs: 'left', sm: 'right' },
                          alignSelf: { xs: 'flex-end', sm: 'center' },
                        }}
                      >
                        <Typography
                          variant="body1"
                          sx={{
                            fontWeight: 800,
                            fontFamily: 'monospace',
                            color: isExpense
                              ? 'text.primary'
                              : isIncome
                              ? 'success.main'
                              : 'secondary.main',
                          }}
                        >
                          {isExpense ? `-¥${h.total_net}` : isIncome ? `+¥${h.total_net}` : `¥${h.total_net}`}
                        </Typography>
                        {(Number(h.payment_discount) > 0 ||
                          Number(h.platform_discount) > 0) && (
                          <Typography
                            variant="caption"
                            sx={{ color: 'success.main', display: 'block' }}
                          >
                            省 ¥{h.payment_discount || h.platform_discount}
                          </Typography>
                        )}
                      </Box>
                    </ListItem>
                  </React.Fragment>
                );
              })}
            </List>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};
