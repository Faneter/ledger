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
  Divider,
  Tooltip,
  Switch,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import AccountBalanceWalletRounded from '@mui/icons-material/AccountBalanceWalletRounded';
import ConfirmationNumberRounded from '@mui/icons-material/ConfirmationNumberRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import BoltRounded from '@mui/icons-material/BoltRounded';
import HourglassEmptyRounded from '@mui/icons-material/HourglassEmptyRounded';

import {
  Account,
  AccountDashboardRow,
  AccountRole,
  RecurringRule,
  RecurringRuleType,
  CronCycle,
  TransactionAggregate,
  Voucher,
  VoucherStatus,
  VoucherType,
  formatCny,
  toDecimal,
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
  // 1. 标签页控制 (0: 资金账户管理, 1: 优惠券卡包, 2: 周期性扣款与定投)
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

  // 3. 实时账户与外币数据
  const accounts: AccountDashboardRow[] = engine.getAccountDashboard();
  const pendingFxTxs: TransactionAggregate[] = engine.getPendingFxTransactions();

  // 完整的底层账户实体映射 (用于读取真实 credit_limit, billing_day, repayment_day, fx_hold_ratio 等)
  const accountDefMap = useMemo(() => {
    return new Map(engine.state.accounts.map((a) => [a.id, a]));
  }, [engine.state.accounts]);

  // 账户分层归类
  const creditAccounts = accounts.filter(
    (a) => a.account_role === 'CREDIT' && !accountDefMap.get(a.id)?.is_folded
  );
  const mainDebitAccounts = accounts.filter(
    (a) =>
      (a.account_role === 'DEBIT_MAIN' || a.account_role === 'PREPAID') &&
      !accountDefMap.get(a.id)?.is_folded
  );
  const fxAccounts = accounts.filter(
    (a) => a.account_role === 'DEBIT_FX' && !accountDefMap.get(a.id)?.is_folded
  );
  const investmentAccounts = accounts.filter(
    (a) => a.account_role === 'INVESTMENT' && !accountDefMap.get(a.id)?.is_folded
  );
  const foldedAccounts = accounts.filter((a) => {
    const def = accountDefMap.get(a.id);
    return def?.is_folded || a.account_role === 'DORMANT';
  });

  // 账户总资产 / 总负债 / 净资产统计 (遵循 include_in_networth)
  const { totalAssets, totalLiabilities, netWorth } = useMemo(() => {
    let assets = toDecimal(0);
    let liabilities = toDecimal(0);

    for (const acc of engine.state.accounts) {
      if (acc.include_in_networth === false) continue;
      const effectiveBal = toDecimal(acc.market_value || acc.book_balance || 0);
      if (effectiveBal.isPositive()) {
        assets = assets.plus(effectiveBal);
      } else if (effectiveBal.isNegative()) {
        liabilities = liabilities.plus(effectiveBal.abs());
      }
    }

    const net = assets.minus(liabilities);
    return {
      totalAssets: formatCny(assets),
      totalLiabilities: formatCny(liabilities),
      netWorth: formatCny(net),
    };
  }, [engine.state.accounts]);

  // 优惠券过滤器 ('ALL' | 'AVAILABLE' | 'USED' | 'EXPIRED')
  const [voucherFilter, setVoucherFilter] = useState<string>('ALL');

  const filteredVouchers = useMemo(() => {
    if (voucherFilter === 'ALL') return engine.state.vouchers;
    return engine.state.vouchers.filter((v) => v.status === voucherFilter);
  }, [engine.state.vouchers, voucherFilter]);

  // ===========================================================================
  // 弹窗状态与表单模型
  // ===========================================================================

  // 1. 账户编辑/新增弹窗
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accountForm, setAccountForm] = useState<{
    id: string;
    name: string;
    account_role: AccountRole;
    currency: string;
    initial_balance: string;
    credit_limit: string;
    billing_day: string;
    repayment_day: string;
    fx_hold_ratio: string;
    fx_cashback_rate: string;
    is_default_pay: boolean;
    is_folded: boolean;
    include_in_networth: boolean;
  }>({
    id: '',
    name: '',
    account_role: 'DEBIT_MAIN',
    currency: 'CNY',
    initial_balance: '0.00',
    credit_limit: '1500.00',
    billing_day: '1',
    repayment_day: '10',
    fx_hold_ratio: '1.020',
    fx_cashback_rate: '0.0100',
    is_default_pay: false,
    is_folded: false,
    include_in_networth: true,
  });

  // 2. 校准余额弹窗
  const [calibrateModalOpen, setCalibrateModalOpen] = useState(false);
  const [calibrateTarget, setCalibrateTarget] = useState<{
    id: string;
    name: string;
    currentBookBalance: string;
  } | null>(null);
  const [targetBookBalance, setTargetBookBalance] = useState('');

  // 3. ETF 市值更新弹窗
  const [etfModalOpen, setEtfModalOpen] = useState(false);
  const [etfTarget, setEtfTarget] = useState<{
    id: string;
    name: string;
    currentMarketValue: string;
  } | null>(null);
  const [etfMarketValueInput, setEtfMarketValueInput] = useState('');

  // 4. 外币预授权正式清算输入
  const [settleInputs, setSettleInputs] = useState<Record<string, string>>({});

  // 5. 优惠券编辑/登记弹窗
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
    accountId: string;
  }>({
    customPrefix: '',
    title: '',
    voucher_type: 'FREE_COUPON',
    face_value: '5.00',
    acquire_cost: '0.00',
    min_spend: '50.00',
    expire_date: '2026-12-31',
    status: 'AVAILABLE',
    accountId: 'ACC_UNION_MAIN',
  });

  // 6. 周期规则编辑/新增弹窗
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [ruleEditingId, setRuleEditingId] = useState<number | null>(null);
  const [ruleForm, setRuleForm] = useState<{
    title: string;
    rule_type: RecurringRuleType;
    cron_cycle: CronCycle;
    trigger_day: number;
    currency: string;
    amount: string;
    account_id: string;
    target_account_id: string;
    budget_pool_id: string;
    auto_reserve_budget: boolean;
  }>({
    title: '',
    rule_type: 'FIXED_EXPENSE',
    cron_cycle: 'MONTHLY',
    trigger_day: 1,
    currency: 'CNY',
    amount: '20.00',
    account_id: 'ACC_UNION_MAIN',
    target_account_id: 'ACC_ALIPAY_FUND',
    budget_pool_id: 'POOL_FIXED',
    auto_reserve_budget: true,
  });

  // ===========================================================================
  // Tab 0: 账户管理操作逻辑
  // ===========================================================================

  const handleOpenAddAccount = () => {
    setEditingAccountId(null);
    setAccountForm({
      id: `ACC_${Date.now()}`,
      name: '',
      account_role: 'DEBIT_MAIN',
      currency: 'CNY',
      initial_balance: '0.00',
      credit_limit: '1500.00',
      billing_day: '1',
      repayment_day: '10',
      fx_hold_ratio: '1.020',
      fx_cashback_rate: '0.0100',
      is_default_pay: false,
      is_folded: false,
      include_in_networth: true,
    });
    setAccountModalOpen(true);
  };

  const handleOpenEditAccount = (accRow: AccountDashboardRow) => {
    const def = accountDefMap.get(accRow.id);
    setEditingAccountId(accRow.id);
    setAccountForm({
      id: accRow.id,
      name: accRow.name,
      account_role: accRow.account_role,
      currency: accRow.currency,
      initial_balance: accRow.book_balance,
      credit_limit: def?.credit_limit || '0.00',
      billing_day: def?.billing_day ? String(def.billing_day) : '',
      repayment_day: def?.repayment_day ? String(def.repayment_day) : '',
      fx_hold_ratio: def?.fx_hold_ratio || '1.000',
      fx_cashback_rate: def?.fx_cashback_rate || '0.0000',
      is_default_pay: def?.is_default_pay ?? false,
      is_folded: def?.is_folded ?? false,
      include_in_networth: def?.include_in_networth ?? true,
    });
    setAccountModalOpen(true);
  };

  const handleSaveAccount = () => {
    if (!accountForm.name.trim()) {
      showToast('请输入账户名称', 'warning');
      return;
    }

    try {
      if (editingAccountId) {
        engine.upsertAccount({
          id: editingAccountId,
          name: accountForm.name.trim(),
          account_role: accountForm.account_role,
          currency: accountForm.currency,
          credit_limit:
            accountForm.account_role === 'CREDIT' ? accountForm.credit_limit : null,
          billing_day:
            accountForm.account_role === 'CREDIT' && accountForm.billing_day
              ? Number(accountForm.billing_day)
              : null,
          repayment_day:
            accountForm.account_role === 'CREDIT' && accountForm.repayment_day
              ? Number(accountForm.repayment_day)
              : null,
          fx_hold_ratio:
            accountForm.account_role === 'DEBIT_FX'
              ? accountForm.fx_hold_ratio
              : '1.000',
          fx_cashback_rate:
            accountForm.account_role === 'DEBIT_FX'
              ? accountForm.fx_cashback_rate
              : '0.0000',
          is_default_pay: accountForm.is_default_pay,
          is_folded: accountForm.is_folded,
          include_in_networth: accountForm.include_in_networth,
        });
        showToast(`账户【${accountForm.name}】属性已更新`, 'success');
      } else {
        const created = engine.upsertAccount({
          id: accountForm.id || `ACC_${Date.now()}`,
          name: accountForm.name.trim(),
          account_role: accountForm.account_role,
          currency: accountForm.currency,
          credit_limit:
            accountForm.account_role === 'CREDIT' ? accountForm.credit_limit : null,
          billing_day:
            accountForm.account_role === 'CREDIT' && accountForm.billing_day
              ? Number(accountForm.billing_day)
              : null,
          repayment_day:
            accountForm.account_role === 'CREDIT' && accountForm.repayment_day
              ? Number(accountForm.repayment_day)
              : null,
          fx_hold_ratio:
            accountForm.account_role === 'DEBIT_FX'
              ? accountForm.fx_hold_ratio
              : '1.000',
          fx_cashback_rate:
            accountForm.account_role === 'DEBIT_FX'
              ? accountForm.fx_cashback_rate
              : '0.0000',
          is_default_pay: accountForm.is_default_pay,
          is_folded: accountForm.is_folded,
          include_in_networth: accountForm.include_in_networth,
        });

        // 若设定了初始非零余额，立即校准
        if (Number(accountForm.initial_balance) !== 0) {
          engine.calibrateAccountBalance(created.id, accountForm.initial_balance);
        }
        showToast(`新增账户【${created.name}】成功`, 'success');
      }

      setAccountModalOpen(false);
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleDeleteAccount = (accId: string, accName: string) => {
    if (!window.confirm(`确定要删除账户【${accName}】吗？`)) return;
    try {
      engine.deleteAccount(accId);
      showToast(`账户【${accName}】已删除`, 'success');
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // 余额校准
  const handleOpenCalibrate = (acc: AccountDashboardRow) => {
    setCalibrateTarget({
      id: acc.id,
      name: acc.name,
      currentBookBalance: acc.book_balance,
    });
    setTargetBookBalance(acc.book_balance);
    setCalibrateModalOpen(true);
  };

  const handleSaveCalibrate = () => {
    if (!calibrateTarget) return;
    if (isNaN(Number(targetBookBalance))) {
      showToast('请输入有效的目标校准账面余额', 'warning');
      return;
    }
    try {
      engine.calibrateAccountBalance(calibrateTarget.id, targetBookBalance);
      showToast(
        `账户【${calibrateTarget.name}】余额已成功校准至 ¥${targetBookBalance}`,
        'success'
      );
      setCalibrateModalOpen(false);
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // ETF 市值更新
  const handleOpenUpdateEtf = (acc: AccountDashboardRow) => {
    setEtfTarget({
      id: acc.id,
      name: acc.name,
      currentMarketValue: acc.market_value || acc.book_balance,
    });
    setEtfMarketValueInput(acc.market_value || acc.book_balance);
    setEtfModalOpen(true);
  };

  const handleSaveEtfMarketValue = () => {
    if (!etfTarget) return;
    if (isNaN(Number(etfMarketValueInput))) {
      showToast('请输入有效的最新市值金额', 'warning');
      return;
    }
    try {
      engine.updateEtfMarketValue(etfTarget.id, etfMarketValueInput);
      showToast(`【${etfTarget.name}】最新市值已更新为 ¥${etfMarketValueInput}`, 'success');
      setEtfModalOpen(false);
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // 万事达外币预授权正式清算
  const handleSettleMastercard = (txId: string) => {
    const val = settleInputs[txId];
    if (!val || isNaN(Number(val)) || Number(val) <= 0) {
      showToast('请输入有效的银行最终正式清算人民币金额（如 31.20）', 'warning');
      return;
    }
    try {
      engine.settleMastercardPending(txId, val);
      setSettleInputs((prev) => {
        const next = { ...prev };
        delete next[txId];
        return next;
      });
      showToast(`外币预授权已正式清算入账 ¥${val}，释放多冻结并锁定返现`, 'success');
      onRefresh?.();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  // ===========================================================================
  // Tab 1: 优惠券卡包操作逻辑
  // ===========================================================================

  const handleOpenFreeVoucherModal = (sampleTitle?: string, sampleFace?: string, sampleMin?: string) => {
    setVoucherEditingId(null);
    setVoucherMode('FREE');
    setVoucherForm({
      customPrefix: '',
      title: sampleTitle || '',
      voucher_type: 'REPAY_COUPON',
      face_value: sampleFace || '5.00',
      acquire_cost: '0.00',
      min_spend: sampleMin || '50.00',
      expire_date: '2026-12-31',
      status: 'AVAILABLE',
      accountId: '',
    });
    setVoucherModalOpen(true);
  };

  const handleOpenBuyVoucherModal = (sampleTitle?: string, sampleFace?: string, sampleCost?: string, sampleMin?: string) => {
    setVoucherEditingId(null);
    setVoucherMode('BUY');
    const defaultAcc = mainDebitAccounts[0]?.id || 'ACC_UNION_MAIN';
    setVoucherForm({
      customPrefix: '',
      title: sampleTitle || '',
      voucher_type: 'PREPAID_COUPON',
      face_value: sampleFace || '10.00',
      acquire_cost: sampleCost || '5.99',
      min_spend: sampleMin || '10.01',
      expire_date: '2026-12-31',
      status: 'AVAILABLE',
      accountId: defaultAcc,
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
      accountId: '',
    });
    setVoucherModalOpen(true);
  };

  const handleSaveVoucher = () => {
    if (isNaN(Number(voucherForm.face_value)) || Number(voucherForm.face_value) <= 0) {
      showToast('请输入有效的面值金额', 'warning');
      return;
    }

    const autoTitle = generateVoucherTitle(
      voucherForm.voucher_type,
      voucherForm.face_value,
      voucherForm.min_spend,
      voucherForm.acquire_cost
    );
    const resolvedTitle = voucherForm.customPrefix.trim()
      ? `${voucherForm.customPrefix.trim()} ${autoTitle}`
      : voucherMode === 'EDIT' && voucherForm.title.trim()
      ? voucherForm.title.trim()
      : autoTitle;

    try {
      if (voucherMode === 'BUY') {
        if (!voucherForm.accountId) {
          showToast('请选择购券支付扣款账户', 'warning');
          return;
        }
        engine.buyVoucher({
          title: resolvedTitle,
          voucher_type: voucherForm.voucher_type,
          face_value: voucherForm.face_value,
          acquire_cost: voucherForm.acquire_cost,
          min_spend: voucherForm.min_spend,
          accountId: voucherForm.accountId,
          expire_date: voucherForm.expire_date || null,
        });
        showToast(
          `成功购入立减金【${resolvedTitle}】，已扣款 ¥${voucherForm.acquire_cost}`,
          'success'
        );
      } else {
        engine.upsertVoucher({
          id: voucherEditingId || undefined,
          title: resolvedTitle,
          voucher_type: voucherForm.voucher_type,
          face_value: voucherForm.face_value,
          acquire_cost: voucherForm.acquire_cost,
          min_spend: voucherForm.min_spend,
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
  // Tab 2: 周期性规则操作逻辑
  // ===========================================================================

  const handleOpenAddRule = (sampleTitle?: string, sampleAmt?: string, sampleDay?: number, sampleType?: RecurringRuleType) => {
    setRuleEditingId(null);
    const defaultAcc = mainDebitAccounts[0]?.id || 'ACC_UNION_MAIN';
    const ruleType = sampleType || 'FIXED_EXPENSE';
    setRuleForm({
      title: sampleTitle || '校园网宽带固定月租',
      rule_type: ruleType,
      cron_cycle: 'MONTHLY',
      trigger_day: sampleDay || 1,
      currency: ruleType === 'FX_SUBSCRIPTION' ? 'USD' : 'CNY',
      amount: sampleAmt || '20.00',
      account_id: defaultAcc,
      target_account_id: investmentAccounts[0]?.id || 'ACC_ALIPAY_FUND',
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
      trigger_day: r.trigger_day,
      currency: r.currency || 'CNY',
      amount: r.amount,
      account_id: r.account_id,
      target_account_id: r.target_account_id || '',
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

    try {
      engine.upsertRecurringRule({
        id: ruleEditingId || undefined,
        title: ruleForm.title.trim(),
        rule_type: ruleForm.rule_type,
        cron_cycle: ruleForm.cron_cycle,
        trigger_day: ruleForm.trigger_day,
        currency: ruleForm.currency,
        amount: ruleForm.amount,
        account_id: ruleForm.account_id,
        target_account_id:
          ruleForm.rule_type === 'AUTO_INVEST' ? ruleForm.target_account_id : null,
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

  // ===========================================================================
  // 辅助渲染方法
  // ===========================================================================

  const renderAccountCard = (acc: AccountDashboardRow) => {
    const def = accountDefMap.get(acc.id);
    const bookNum = Number(acc.book_balance);
    const isCredit = acc.account_role === 'CREDIT';
    const isFx = acc.account_role === 'DEBIT_FX';
    const isInvestment = acc.account_role === 'INVESTMENT';
    const isNegative = bookNum < 0;

    return (
      <Grid size={{ xs: 12, sm: 6, md: 4 }} key={acc.id}>
        <Card
          sx={{
            height: '100%',
            borderRadius: 3,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            border: '1px solid',
            borderColor: isFx ? 'info.main' : isCredit ? 'secondary.main' : 'divider',
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
                  {acc.name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  {isCredit
                    ? `信用额度: ¥${def?.credit_limit || '0.00'}`
                    : isFx
                    ? `102%预授权冻结 · 1%返现`
                    : isInvestment
                    ? '投资理财账户'
                    : acc.account_role === 'PREPAID'
                    ? '预充值卡'
                    : '核心结算账户'}
                </Typography>
              </Box>

              <Stack direction="row" spacing={0.5}>
                {def?.is_default_pay && (
                  <Chip size="small" color="primary" label="默认" variant="outlined" />
                )}
                <Chip
                  size="small"
                  label={acc.account_role}
                  color={
                    isCredit
                      ? 'secondary'
                      : isFx
                      ? 'info'
                      : isInvestment
                      ? 'warning'
                      : 'default'
                  }
                />
              </Stack>
            </Stack>

            {/* 信用账户账单日与还款日 */}
            {isCredit && (def?.billing_day || def?.repayment_day) && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  账单日: 每月 {def.billing_day || '-'} 日 · 还款日: 每月 {def.repayment_day || '-'} 日
                </Typography>
              </Box>
            )}

            {/* 余额指标展示 */}
            <Box sx={{ my: 1.5 }}>
              {isInvestment ? (
                <>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      最新总市值
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary' }}>
                      ¥{acc.market_value || acc.book_balance}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      持仓成本: ¥{acc.book_balance}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 700,
                        color: Number(acc.unrealized_pnl) >= 0 ? 'success.main' : 'error.main',
                      }}
                    >
                      浮动盈亏: {Number(acc.unrealized_pnl) >= 0 ? '+' : ''}¥{acc.unrealized_pnl}
                    </Typography>
                  </Stack>
                </>
              ) : isCredit ? (
                <>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      当前未还本金 (账面)
                    </Typography>
                    <Typography
                      variant="h6"
                      sx={{
                        fontWeight: 800,
                        color: isNegative ? 'error.main' : 'text.primary',
                      }}
                    >
                      ¥{acc.book_balance}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      当前可用额度
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'success.main' }}>
                      ¥{acc.available_balance}
                    </Typography>
                  </Stack>
                </>
              ) : (
                <>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      可用余额 (扣除冻结)
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary' }}>
                      ¥{acc.available_balance}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', mt: 0.5 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      账面总余额: ¥{acc.book_balance}
                    </Typography>
                    {Number(acc.frozen_amount) > 0 && (
                      <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 700 }}>
                        已冻结: ¥{acc.frozen_amount}
                      </Typography>
                    )}
                  </Stack>
                </>
              )}
            </Box>

            {/* 投资账户更新市值动作按钮 */}
            {isInvestment && (
              <Button
                fullWidth
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<TrendingUpRounded />}
                onClick={() => handleOpenUpdateEtf(acc)}
                sx={{ mt: 1, borderRadius: 2 }}
              >
                更新最新市值
              </Button>
            )}
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
            <Tooltip title="校准账户真实余额">
              <Button
                size="small"
                variant="text"
                color="primary"
                startIcon={<TuneRounded />}
                onClick={() => handleOpenCalibrate(acc)}
                sx={{ fontSize: '0.75rem' }}
              >
                校准余额
              </Button>
            </Tooltip>
            <Tooltip title="编辑账户属性">
              <IconButton size="small" color="primary" onClick={() => handleOpenEditAccount(acc)}>
                <EditRounded fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="删除账户">
              <IconButton size="small" color="error" onClick={() => handleDeleteAccount(acc.id, acc.name)}>
                <DeleteOutlineRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Card>
      </Grid>
    );
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
              icon={<AccountBalanceWalletRounded fontSize="small" />}
              iconPosition="start"
              label="资金账户管理"
              sx={{ fontWeight: 700 }}
            />
            <Tab
              icon={<ConfirmationNumberRounded fontSize="small" />}
              iconPosition="start"
              label="优惠券卡包"
              sx={{ fontWeight: 700 }}
            />
            <Tab
              icon={<EventRepeatRounded fontSize="small" />}
              iconPosition="start"
              label="周期性扣款与定投"
              sx={{ fontWeight: 700 }}
            />
          </Tabs>
        </Box>
      </Card>

      {/* ===================================================================== */}
      {/* Tab 0: 资金账户管理 (Accounts) */}
      {/* ===================================================================== */}
      {activeTab === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 顶栏：净资产总览与新增账户操作 */}
          <Card sx={{ borderRadius: 3, p: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  资金账户矩阵与资产负债概览
                </Typography>
                <Stack direction="row" spacing={3} sx={{ alignItems: 'baseline', mt: 0.5 }}>
                  <Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      总资产
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: 'success.main' }}>
                      ¥{totalAssets}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      总负债 (未还)
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: 'error.main' }}>
                      ¥{totalLiabilities}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      净资产
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 900, color: 'primary.main' }}>
                      ¥{netWorth}
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              <Button
                variant="contained"
                color="primary"
                startIcon={<AddRounded />}
                onClick={handleOpenAddAccount}
              >
                新增账户
              </Button>
            </Stack>
          </Card>

          {/* 万事达外币待正式清算提醒卡片 */}
          {pendingFxTxs.length > 0 && (
            <Alert
              severity="warning"
              icon={<HourglassEmptyRounded />}
              sx={{ borderRadius: 3, '& .MuiAlert-message': { width: '100%' } }}
            >
              <Box sx={{ width: '100%' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  万事达外币预授权待正式清算 ({pendingFxTxs.length} 笔)
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
                  T+1/T+2 银行出账后，输入银行最终正式清算的人民币金额，释放 102% 多冻结并锁定入账 1% 返现。
                </Typography>

                <Stack spacing={1}>
                  {pendingFxTxs.map((tx) => {
                    const h = tx.header;
                    const val = settleInputs[h.id] ?? '';
                    return (
                      <Card
                        key={h.id}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          display: 'flex',
                          flexDirection: { xs: 'column', sm: 'row' },
                          justifyContent: 'space-between',
                          alignItems: { sm: 'center' },
                          gap: 1.5,
                        }}
                      >
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {h.merchant_or_note || '外币消费记账'}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            原币: {h.original_currency} {h.original_amount} · 冻结人民币: ¥{h.hold_amount_cny}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <TextField
                            size="small"
                            type="number"
                            placeholder="银行最终实付 (如 31.20)"
                            value={val}
                            onChange={(e) =>
                              setSettleInputs({ ...settleInputs, [h.id]: e.target.value })
                            }
                            sx={{ width: 190 }}
                          />
                          <Button
                            size="small"
                            variant="contained"
                            color="warning"
                            onClick={() => handleSettleMastercard(h.id)}
                          >
                            清算解冻锁定
                          </Button>
                        </Stack>
                      </Card>
                    );
                  })}
                </Stack>
              </Box>
            </Alert>
          )}

          {/* 1. 信用支付账户（花呗/信用卡） */}
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <Chip size="small" color="secondary" label="信用支付账户（花呗/信用卡）" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                花呗 / 信用卡 负债与免息期管控 ({creditAccounts.length})
              </Typography>
            </Stack>
            <Grid container spacing={2}>
              {creditAccounts.map(renderAccountCard)}
            </Grid>
          </Box>

          {/* 2. 储蓄卡与校园饭卡 */}
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <Chip size="small" color="primary" label="储蓄卡与校园饭卡" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                主力借记卡 & 预充值校园饭卡 ({mainDebitAccounts.length})
              </Typography>
            </Stack>
            <Grid container spacing={2}>
              {mainDebitAccounts.map(renderAccountCard)}
            </Grid>
          </Box>

          {/* 3. 外币预授权借记卡 */}
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <Chip size="small" color="info" label="外币预授权借记卡" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                万事达跨境借记卡 (102%预授权冻结 + 1%返现) ({fxAccounts.length})
              </Typography>
            </Stack>
            <Grid container spacing={2}>
              {fxAccounts.map(renderAccountCard)}
            </Grid>
          </Box>

          {/* 4. 投资理财账户 */}
          <Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <Chip size="small" color="warning" label="投资理财账户" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                指数基金与理财账户 ({investmentAccounts.length})
              </Typography>
            </Stack>
            <Grid container spacing={2}>
              {investmentAccounts.map(renderAccountCard)}
            </Grid>
          </Box>

          {/* 5. 备用折叠账户 (Accordion) */}
          {foldedAccounts.length > 0 && (
            <Accordion sx={{ borderRadius: '12px !important', overflow: 'hidden' }}>
              <AccordionSummary expandIcon={<ExpandMoreRounded />}>
                <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                  📁 备用折叠账户 ({foldedAccounts.length} 个)
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Grid container spacing={2}>
                  {foldedAccounts.map(renderAccountCard)}
                </Grid>
              </AccordionDetails>
            </Accordion>
          )}
        </Box>
      )}

      {/* ===================================================================== */}
      {/* Tab 1: 优惠券卡包 (Vouchers) */}
      {/* ===================================================================== */}
      {activeTab === 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 顶栏：卡券过滤与新增操作 */}
          <Card sx={{ borderRadius: 3, p: 2 }}>
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
            <Card sx={{ borderRadius: 3, p: 4, textAlign: 'center' }}>
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
                    handleOpenFreeVoucherModal('微信信用卡还款立减券', '5.00', '50.00')
                  }
                >
                  添加示例: 还款5元立减券 (面值 ¥5.00 / 满 ¥50.00)
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
                        borderRadius: 3,
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
                                  : v.voucher_type === 'REPAY_COUPON'
                                  ? '还款立减券'
                                  : '免费平台券'
                              }
                              color={
                                v.voucher_type === 'PREPAID_COUPON'
                                  ? 'primary'
                                  : v.voucher_type === 'REPAY_COUPON'
                                  ? 'secondary'
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
      {/* Tab 2: 周期性扣款与定投 (Recurring Rules) */}
      {/* ===================================================================== */}
      {activeTab === 2 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* 顶栏：周期规则头部 */}
          <Card sx={{ borderRadius: 3, p: 2 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  周期性扣款与自动定投规则
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  管理校园网、自动定投、外币订阅等周期规则，支持到期一键生成记账流水
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
            <Card sx={{ borderRadius: 3, p: 4, textAlign: 'center' }}>
              <EventRepeatRounded sx={{ fontSize: 56, color: 'text.secondary', mb: 1 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                暂无任何周期性扣款或定投规则
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 500, mx: 'auto', mb: 3 }}>
                纯净模式下未预置测试规则。你可以点击下方按钮一键载入常见校园生活扣款模板：
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
                  color="secondary"
                  startIcon={<AddRounded />}
                  onClick={() =>
                    handleOpenAddRule('沪深300指数自动定投', '50.00', 5, 'AUTO_INVEST')
                  }
                >
                  创建示例: 沪深300指数定投 (¥50.00 / 每月 5 日)
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
                const acc = accountDefMap.get(rule.account_id);
                const targetAcc = rule.target_account_id
                  ? accountDefMap.get(rule.target_account_id)
                  : null;

                return (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={rule.id}>
                    <Card
                      sx={{
                        height: '100%',
                        borderRadius: 3,
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
                              rule.rule_type === 'AUTO_INVEST'
                                ? '自动转账/定投'
                                : rule.rule_type === 'FX_SUBSCRIPTION'
                                ? '外币周期订阅'
                                : '固定生活开支'
                            }
                            color={
                              rule.rule_type === 'AUTO_INVEST'
                                ? 'secondary'
                                : rule.rule_type === 'FX_SUBSCRIPTION'
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

                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                            扣款账户: <strong>{acc ? acc.name : rule.account_id}</strong>
                            {targetAcc && (
                              <span> ➔ 目标账户: <strong>{targetAcc.name}</strong></span>
                            )}
                          </Typography>

                          {rule.rule_type !== 'AUTO_INVEST' && rule.budget_pool_id && (
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
                          sx={{ mt: 1.5, borderRadius: 2 }}
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
      {/* 弹窗 1: 账户新增与编辑 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={accountModalOpen}
        onClose={() => setAccountModalOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {editingAccountId ? `编辑账户: ${accountForm.name}` : '新增资金账户'}
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="账户名称"
            fullWidth
            size="small"
            value={accountForm.name}
            onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
            placeholder="如: 支付宝花呗 / 招商银行卡"
          />

          <FormControl fullWidth size="small">
            <InputLabel>账户职能角色</InputLabel>
            <Select
              value={accountForm.account_role}
              label="账户职能角色"
              onChange={(e) =>
                setAccountForm({
                  ...accountForm,
                  account_role: e.target.value as AccountRole,
                })
              }
            >
              <MenuItem value="CREDIT">信用支付账户（花呗/信用卡）</MenuItem>
              <MenuItem value="DEBIT_MAIN">储蓄卡与校园饭卡</MenuItem>
              <MenuItem value="DEBIT_FX">外币预授权借记卡</MenuItem>
              <MenuItem value="PREPAID">储蓄卡与校园饭卡</MenuItem>
              <MenuItem value="INVESTMENT">投资理财账户</MenuItem>
              <MenuItem value="DORMANT">备用折叠账户</MenuItem>
            </Select>
          </FormControl>

          {!editingAccountId && (
            <TextField
              label="初始账面余额 (¥)"
              fullWidth
              size="small"
              type="number"
              value={accountForm.initial_balance}
              onChange={(e) => setAccountForm({ ...accountForm, initial_balance: e.target.value })}
              helperText="创建时自动校准至该余额基准"
            />
          )}

          {/* 信用账户专属字段 */}
          {accountForm.account_role === 'CREDIT' && (
            <>
              <TextField
                label="信用授信额度 (¥)"
                fullWidth
                size="small"
                type="number"
                value={accountForm.credit_limit}
                onChange={(e) => setAccountForm({ ...accountForm, credit_limit: e.target.value })}
                placeholder="如 1500.00"
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="每月账单日"
                  fullWidth
                  size="small"
                  type="number"
                  value={accountForm.billing_day}
                  onChange={(e) => setAccountForm({ ...accountForm, billing_day: e.target.value })}
                  placeholder="如 1"
                />
                <TextField
                  label="每月还款日"
                  fullWidth
                  size="small"
                  type="number"
                  value={accountForm.repayment_day}
                  onChange={(e) => setAccountForm({ ...accountForm, repayment_day: e.target.value })}
                  placeholder="如 10"
                />
              </Stack>
            </>
          )}

          {/* 外币卡专属字段 */}
          {accountForm.account_role === 'DEBIT_FX' && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="预授权冻结比率"
                fullWidth
                size="small"
                value={accountForm.fx_hold_ratio}
                onChange={(e) => setAccountForm({ ...accountForm, fx_hold_ratio: e.target.value })}
                placeholder="默认 1.020 (即 102%)"
              />
              <TextField
                label="境外刷卡返现比率"
                fullWidth
                size="small"
                value={accountForm.fx_cashback_rate}
                onChange={(e) => setAccountForm({ ...accountForm, fx_cashback_rate: e.target.value })}
                placeholder="默认 0.0100 (即 1%)"
              />
            </Stack>
          )}

          {/* 属性开关 */}
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Switch
                  checked={accountForm.is_default_pay}
                  onChange={(e) => setAccountForm({ ...accountForm, is_default_pay: e.target.checked })}
                />
              }
              label="设为记账默认支付账户"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={accountForm.include_in_networth}
                  onChange={(e) =>
                    setAccountForm({ ...accountForm, include_in_networth: e.target.checked })
                  }
                />
              }
              label="计入个人净资产统计"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={accountForm.is_folded}
                  onChange={(e) => setAccountForm({ ...accountForm, is_folded: e.target.checked })}
                />
              }
              label="放入折叠/睡眠列表"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setAccountModalOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSaveAccount}>
            保存账户
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===================================================================== */}
      {/* 弹窗 2: 校准账户实际余额 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={calibrateModalOpen}
        onClose={() => setCalibrateModalOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          校准余额: {calibrateTarget?.name}
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            当前系统账面余额: <strong>¥{calibrateTarget?.currentBookBalance}</strong>
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            输入银行 App 中的真实当前可用余额，系统将自动核算期初差额基准并生成校准 OpLog，使账面与实际精确对齐。
          </Typography>
          <TextField
            label="真实最新账面余额 (¥)"
            fullWidth
            size="small"
            type="number"
            value={targetBookBalance}
            onChange={(e) => setTargetBookBalance(e.target.value)}
            placeholder="如 1250.00"
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCalibrateModalOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSaveCalibrate}>
            确认校准
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===================================================================== */}
      {/* 弹窗 3: 更新 ETF 市值 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={etfModalOpen}
        onClose={() => setEtfModalOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          更新基金市值: {etfTarget?.name}
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            当前记录总市值: <strong>¥{etfTarget?.currentMarketValue}</strong>
          </Typography>
          <TextField
            label="最新总市值金额 (¥)"
            fullWidth
            size="small"
            type="number"
            value={etfMarketValueInput}
            onChange={(e) => setEtfMarketValueInput(e.target.value)}
            placeholder="如 308.50"
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setEtfModalOpen(false)}>取消</Button>
          <Button variant="contained" color="warning" onClick={handleSaveEtfMarketValue}>
            保存市值
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===================================================================== */}
      {/* 弹窗 4: 优惠券编辑 / 登记 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={voucherModalOpen}
        onClose={() => setVoucherModalOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
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
              borderRadius: 2,
              bgcolor: (t) =>
                t.palette.mode === 'light' ? 'primary.50' : 'grey.900',
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
              label={`${voucherForm.customPrefix.trim() ? voucherForm.customPrefix.trim() + ' ' : ''}${generateVoucherTitle(
                voucherForm.voucher_type,
                voucherForm.face_value,
                voucherForm.min_spend,
                voucherForm.acquire_cost
              )}`}
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
              <MenuItem value="REPAY_COUPON">信用卡/花呗还款券</MenuItem>
            </Select>
          </FormControl>

          {/* 若为有偿购券，需选择扣款支付账户 */}
          {voucherMode === 'BUY' && (
            <FormControl fullWidth size="small">
              <InputLabel>支付购券扣款账户</InputLabel>
              <Select
                value={voucherForm.accountId}
                label="支付购券扣款账户"
                onChange={(e) => setVoucherForm({ ...voucherForm, accountId: e.target.value })}
              >
                {mainDebitAccounts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name} (可用 ¥{a.available_balance})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

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
      {/* 弹窗 5: 周期规则新增与编辑 Dialog */}
      {/* ===================================================================== */}
      <Dialog
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: 3 } } }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {ruleEditingId ? `编辑周期规则: ${ruleForm.title}` : '新增周期扣款/定投规则'}
        </DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="规则标题 / 说明"
            fullWidth
            size="small"
            value={ruleForm.title}
            onChange={(e) => setRuleForm({ ...ruleForm, title: e.target.value })}
            placeholder="如: 校园网固定宽带 / 沪深300指数自动定投"
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel>规则类型</InputLabel>
              <Select
                value={ruleForm.rule_type}
                label="规则类型"
                onChange={(e) => {
                  const nextType = e.target.value as RecurringRuleType;
                  const nextCurrency =
                    nextType === 'FX_SUBSCRIPTION' && ruleForm.currency === 'CNY'
                      ? 'USD'
                      : ruleForm.currency;
                  setRuleForm({
                    ...ruleForm,
                    rule_type: nextType,
                    currency: nextCurrency,
                  });
                }}
              >
                <MenuItem value="FIXED_EXPENSE">固定生活开支</MenuItem>
                <MenuItem value="AUTO_INVEST">自动转账/基金定投</MenuItem>
                <MenuItem value="FX_SUBSCRIPTION">外币周期订阅</MenuItem>
              </Select>
            </FormControl>

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
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
              onChange={(e) => setRuleForm({ ...ruleForm, trigger_day: Number(e.target.value) })}
              placeholder="如 1"
            />
          </Stack>

          <FormControl fullWidth size="small">
            <InputLabel>支付扣款账户</InputLabel>
            <Select
              value={ruleForm.account_id}
              label="支付扣款账户"
              onChange={(e) => setRuleForm({ ...ruleForm, account_id: e.target.value })}
            >
              {engine.state.accounts.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  {a.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {ruleForm.rule_type === 'AUTO_INVEST' && (
            <FormControl fullWidth size="small">
              <InputLabel>目标投资理财账户</InputLabel>
              <Select
                value={ruleForm.target_account_id}
                label="目标投资理财账户"
                onChange={(e) => setRuleForm({ ...ruleForm, target_account_id: e.target.value })}
              >
                {investmentAccounts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {ruleForm.rule_type !== 'AUTO_INVEST' && (
            <FormControl fullWidth size="small">
              <InputLabel>绑定资金池</InputLabel>
              <Select
                value={ruleForm.budget_pool_id}
                label="绑定资金池"
                onChange={(e) => setRuleForm({ ...ruleForm, budget_pool_id: e.target.value })}
              >
                {engine.state.budgetPools.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

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
          sx={{ width: '100%', borderRadius: 2 }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};
