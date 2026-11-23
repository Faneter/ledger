import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Card,
  CardContent,
  Stack,
  Typography,
  Button,
  Chip,
  Alert,
  Divider,
  Switch,
  FormControlLabel,
  Box,
  Grid,
  IconButton,
  CircularProgress,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CloudDoneRounded from '@mui/icons-material/CloudDoneRounded';
import CloudOffRounded from '@mui/icons-material/CloudOffRounded';
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import SyncRounded from '@mui/icons-material/SyncRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import BackupRounded from '@mui/icons-material/BackupRounded';

import { LocalLedgerEngine } from '../sync/local-replica';
import { SyncConflict } from '@ledger/core';

interface SyncAndConflictModalProps {
  engine: LocalLedgerEngine;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
  syncing?: boolean;
  onManualSync?: () => Promise<{ success: boolean; message?: string }>;
}

function formatConflictEntityLabel(conflictType: string): string {
  const upper = (conflictType || '').toUpperCase();
  if (upper.includes('TRANSACTION')) return '流水记录';
  if (upper.includes('MONTHLY_BUDGET') || upper === 'BUDGET') return '月度预算';
  if (upper.includes('BUDGET_POOL')) return '预算资金池';
  if (upper.includes('PROJECT_TAG')) return '专项预算';
  if (upper.includes('RECURRING')) return '周期扣款规则';
  if (upper.includes('CATEGORY')) return '收支分类';
  return '账本记录';
}

export const SyncAndConflictModal: React.FC<SyncAndConflictModalProps> = ({
  engine,
  isOpen,
  onClose,
  onRefresh,
  syncing = false,
  onManualSync,
}) => {
  const [localLoading, setLocalLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    severity: 'success' | 'info' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const isBusy = syncing || localLoading;
  const isOffline = engine.state.isOfflineMode;
  const pendingCount = engine.state.pendingSyncOps.length;
  const conflicts: SyncConflict[] = engine.state.conflicts;
  const pendingConflicts = conflicts.filter((c) => c.status === 'PENDING');

  const handleToggleOffline = (checked: boolean) => {
    engine.setOfflineMode(checked);
    setFeedback({
      severity: 'info',
      message: checked
        ? '已切换为「仅存本地」模式，暂不会向云端发送更新。'
        : '已恢复云端自动同步。',
    });
    onRefresh?.();
  };

  const handleSyncNow = async () => {
    if (isOffline) {
      setFeedback({
        severity: 'warning',
        message: '当前处于「仅存本地」模式，请先关闭该开关后再同步至云端。',
      });
      return;
    }

    setLocalLoading(true);
    setFeedback(null);
    try {
      if (onManualSync) {
        const res = await onManualSync();
        setFeedback({
          severity: res.success ? 'success' : 'warning',
          message:
            res.message ||
            (res.success ? '云端同步已完成，各端数据保持一致。' : '暂未连接到云端服务，变更已安全保存于本机。'),
        });
      } else {
        const res = await engine.syncWithServer();
        if (res.serverResetDetected) {
          setFeedback({
            severity: 'warning',
            message: '检测到云端账本为空，请确认是否将本机账本恢复至云端。',
          });
        } else if (res.success) {
          const msgParts = ['云端同步已完成'];
          if (res.appliedRemoteCount > 0) {
            msgParts.push(`更新 ${res.appliedRemoteCount} 条远端记录`);
          }
          if (pendingConflicts.length > 0 || res.conflictsDetected > 0) {
            msgParts.push('请留意下方的多端修改差异确认');
          }
          setFeedback({
            severity: 'success',
            message: msgParts.join('，') + '。',
          });
        } else {
          setFeedback({
            severity: 'warning',
            message: '暂未连接到云端服务，数据已安全保存在本机。',
          });
        }
        onRefresh?.();
      }
    } catch {
      setFeedback({
        severity: 'warning',
        message: '暂未连接到云端服务，数据已安全保存在本机。',
      });
    } finally {
      setLocalLoading(false);
    }
  };

  const handlePushFullToServer = async () => {
    if (isOffline) {
      setFeedback({
        severity: 'warning',
        message: '当前处于「仅存本地」模式，无法覆盖云端数据。',
      });
      return;
    }

    if (
      !engine.serverResetDetected &&
      !window.confirm(
        '确定要用本机当前的完整账本数据覆盖云端吗？\n云端原有账本将被替换为本机当前状态，适用于以本机为准的灾备恢复。'
      )
    ) {
      return;
    }

    setLocalLoading(true);
    setFeedback(null);
    try {
      const res = await engine.pushLocalBundleToServer();
      setFeedback({
        severity: 'success',
        message: `已将本机完整账本同步至云端（共 ${res.restoredTransactions} 笔流水），当前各端已保持一致。`,
      });
      onRefresh?.();
    } catch (err) {
      setFeedback({
        severity: 'error',
        message:
          err instanceof Error
            ? `上传失败：${err.message}`
            : '上传至云端失败，请确认云端服务是否可用。',
      });
    } finally {
      setLocalLoading(false);
    }
  };

  const handleResolveConflict = (
    conflictId: string,
    resolution: 'KEEP_WINNER' | 'USE_LOSER'
  ) => {
    try {
      engine.resolveConflict(conflictId, resolution);
      setFeedback({
        severity: 'success',
        message:
          resolution === 'KEEP_WINNER'
            ? '已确认保留当前版本内容。'
            : '已切换采纳另一台设备的修改。',
      });
      onRefresh?.();
    } catch (err) {
      setFeedback({
        severity: 'error',
        message: err instanceof Error ? err.message : '处理冲突时发生错误。',
      });
    }
  };

  const getStatusChip = () => {
    if (isBusy) {
      return (
        <Chip
          size="small"
          color="info"
          icon={<CircularProgress size={14} color="inherit" />}
          label="正在同步..."
        />
      );
    }
    if (isOffline) {
      return (
        <Chip
          size="small"
          color="warning"
          icon={<CloudOffRounded />}
          label="仅存本地模式"
        />
      );
    }
    if (pendingCount > 0) {
      return (
        <Chip
          size="small"
          color="warning"
          icon={<CloudUploadRounded />}
          label={`本地已保存 (${pendingCount} 笔待同步)`}
        />
      );
    }
    return (
      <Chip
        size="small"
        color="success"
        icon={<CloudDoneRounded />}
        label="云端已同步"
      />
    );
  };

  const lastSyncText = engine.state.lastSyncAt
    ? new Date(engine.state.lastSyncAt).toLocaleString()
    : '尚未与云端同步';

  return (
    <Dialog open={isOpen} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontWeight: 700,
          pb: 1.5,
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CloudDoneRounded color="primary" />
          <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
            云端同步与差异处理
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onClose} aria-label="关闭">
          <CloseRounded fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: 2.5 }}>
        {/* 操作反馈提示 */}
        {feedback && (
          <Alert severity={feedback.severity} onClose={() => setFeedback(null)}>
            {feedback.message}
          </Alert>
        )}

        {/* 1. 云端空库恢复提示 */}
        {engine.serverResetDetected && (
          <Alert
            severity="warning"
            icon={<WarningAmberRounded />}
            action={
              <Button
                color="warning"
                variant="contained"
                size="small"
                disabled={isBusy || isOffline}
                onClick={handlePushFullToServer}
                sx={{ whiteSpace: 'nowrap' }}
              >
                恢复至云端
              </Button>
            }
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              检测到云端账本为空
            </Typography>
            <Typography variant="caption" sx={{ display: 'block' }}>
              云端可能刚刚初始化或重置，是否将本机已有的账本数据完整恢复至云端？
            </Typography>
          </Alert>
        )}

        {/* 2. 云端同步状态卡片 */}
        <Card variant="outlined">
          <CardContent sx={{ p: 2.5 }}>
            <Stack spacing={2}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
              >
                <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      当前同步状态
                    </Typography>
                    {getStatusChip()}
                  </Stack>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    上次同步时间：{lastSyncText}
                  </Typography>
                </Box>

                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  startIcon={isBusy ? <CircularProgress size={16} color="inherit" /> : <SyncRounded />}
                  disabled={isBusy || isOffline}
                  onClick={handleSyncNow}
                >
                  {isBusy ? '同步中...' : '立即同步'}
                </Button>
              </Stack>

              <Divider />

              <FormControlLabel
                control={
                  <Switch
                    checked={isOffline}
                    onChange={(e) => handleToggleOffline(e.target.checked)}
                    color="warning"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      仅存本地（暂停云同步）
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                      开启后所有记账变更只保存在当前浏览器中，关闭后会自动补传至云端。
                    </Typography>
                  </Box>
                }
                sx={{ m: 0, alignItems: 'flex-start' }}
              />
            </Stack>
          </CardContent>
        </Card>

        {/* 3. 多端修改差异处理 */}
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              多端修改差异确认
            </Typography>
            {pendingConflicts.length > 0 && (
              <Chip
                size="small"
                color="warning"
                label={`${pendingConflicts.length} 项待确认`}
              />
            )}
          </Stack>

          {pendingConflicts.length === 0 ? (
            <Card
              variant="outlined"
              sx={{
                bgcolor: (t) => alpha(t.palette.success.main, 0.04),
                borderColor: (t) => alpha(t.palette.success.main, 0.25),
              }}
            >
              <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 } }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <CheckCircleOutlineRounded color="success" />
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    当前各端数据一致，无修改冲突。
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          ) : (
            <Stack spacing={2}>
              {pendingConflicts.map((cf) => (
                <Card
                  key={cf.id}
                  variant="outlined"
                  sx={{ borderColor: 'warning.main' }}
                >
                  <CardContent sx={{ p: 2 }}>
                    <Stack
                      direction="row"
                      sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
                    >
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {formatConflictEntityLabel(cf.conflict_type)}存在同时修改
                      </Typography>
                      <Chip size="small" color="warning" label="待确认" />
                    </Stack>

                    <Grid container spacing={1.5}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <Box
                          sx={{
                            p: 1.5,
                            borderRadius: '12px',
                            border: '1px solid',
                            borderColor: (t) => alpha(t.palette.primary.main, 0.3),
                            bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
                            height: '100%',
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ fontWeight: 700, color: 'primary.main', display: 'block', mb: 0.5 }}
                          >
                            当前保留内容
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'text.primary', wordBreak: 'break-word' }}>
                            {cf.winner_summary}
                          </Typography>
                        </Box>
                      </Grid>

                      <Grid size={{ xs: 12, sm: 6 }}>
                        <Box
                          sx={{
                            p: 1.5,
                            borderRadius: '12px',
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.default',
                            height: '100%',
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.5 }}
                          >
                            另一台设备的修改
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'text.primary', wordBreak: 'break-word' }}>
                            {cf.loser_summary}
                          </Typography>
                        </Box>
                      </Grid>
                    </Grid>

                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 1.5 }}>
                      <Button
                        size="small"
                        variant="contained"
                        color="primary"
                        onClick={() => handleResolveConflict(cf.id, 'KEEP_WINNER')}
                      >
                        保留当前内容
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="secondary"
                        onClick={() => handleResolveConflict(cf.id, 'USE_LOSER')}
                      >
                        采用另一台设备的修改
                      </Button>
                    </Stack>
                  </CardContent>
                </Card>
              ))}
            </Stack>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Button
          size="small"
          color="inherit"
          startIcon={<BackupRounded />}
          disabled={isBusy || isOffline}
          onClick={handlePushFullToServer}
          sx={{ color: 'text.secondary' }}
        >
          用本机数据完整覆盖云端
        </Button>
        <Button variant="contained" onClick={onClose}>
          完成
        </Button>
      </DialogActions>
    </Dialog>
  );
};
