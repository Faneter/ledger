import React from 'react';
import { Card, Tabs, Tab } from '@mui/material';
import { alpha } from '@mui/material/styles';

export interface PageSectionTabItem {
  label: string;
  icon: React.ReactElement;
}

export interface PageSectionTabsProps {
  value: number;
  onChange: (value: number) => void;
  tabs: PageSectionTabItem[];
}

/**
 * 顶部卡片式分段选项卡（MD3 同心圆角胶囊风格）：
 * 消除内边距顶部留白导致的波纹/悬停与滑动指示器无法覆盖整个高度的问题。
 */
export const PageSectionTabs: React.FC<PageSectionTabsProps> = ({
  value,
  onChange,
  tabs,
}) => {
  return (
    <Card sx={{ p: 0.75, overflow: 'hidden' }}>
      <Tabs
        value={value}
        onChange={(_, val: number) => onChange(val)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          minHeight: 44,
          position: 'relative',
          '& .MuiTabs-flexContainer': {
            gap: 0.75,
            position: 'relative',
            zIndex: 1,
          },
          '& .MuiTabs-indicator': {
            height: '100%',
            top: 0,
            bottom: 0,
            borderRadius: '14px',
            bgcolor: (t) =>
              alpha(t.palette.primary.main, t.palette.mode === 'light' ? 0.1 : 0.16),
            zIndex: 0,
          },
          '& .MuiTab-root': {
            minHeight: 44,
            py: 1,
            px: 2.5,
            borderRadius: '14px',
            overflow: 'hidden',
            fontWeight: 700,
            textTransform: 'none',
            color: 'text.secondary',
            transition: 'color 0.2s ease, background-color 0.2s ease',
            '&:hover': {
              bgcolor: (t) =>
                alpha(t.palette.primary.main, t.palette.mode === 'light' ? 0.05 : 0.08),
            },
            '&.Mui-selected': {
              color: 'primary.main',
              '&:hover': {
                bgcolor: 'transparent',
              },
            },
          },
        }}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.label}
            icon={tab.icon}
            iconPosition="start"
            label={tab.label}
          />
        ))}
      </Tabs>
    </Card>
  );
};
