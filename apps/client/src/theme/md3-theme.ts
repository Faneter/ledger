import { createTheme, Theme, alpha } from '@mui/material/styles';

/**
 * Google Material Design 3 (MD3) Theme Configuration
 * Supports light & dark modes with clean warm-neutral and deep slate surfaces,
 * rounded pill geometry, and tonal elevations.
 */
export function createMd3Theme(mode: 'light' | 'dark'): Theme {
  const isLight = mode === 'light';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isLight ? '#0b57d0' : '#a8c7fa',
        contrastText: isLight ? '#ffffff' : '#042e6d',
      },
      secondary: {
        main: isLight ? '#006874' : '#4fd8eb',
        contrastText: isLight ? '#ffffff' : '#00363d',
      },
      success: {
        main: isLight ? '#146c2e' : '#7ada8b',
        contrastText: isLight ? '#ffffff' : '#043912',
      },
      warning: {
        main: isLight ? '#ba6200' : '#ffb77c',
        contrastText: isLight ? '#ffffff' : '#492300',
      },
      error: {
        main: isLight ? '#ba1a1a' : '#ffb4ab',
        contrastText: isLight ? '#ffffff' : '#690005',
      },
      info: {
        main: isLight ? '#00639b' : '#91cdff',
      },
      background: {
        default: isLight ? '#f8f9ff' : '#0f141c',
        paper: isLight ? '#ffffff' : '#181e29',
      },
      text: {
        primary: isLight ? '#191c20' : '#e1e2e8',
        secondary: isLight ? '#43474e' : '#8d9199',
      },
      divider: isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)',
    },
    shape: {
      borderRadius: 16,
    },
    typography: {
      fontFamily: [
        'Google Sans',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        '"PingFang SC"',
        '"Microsoft YaHei"',
        'sans-serif',
      ].join(','),
      button: {
        textTransform: 'none',
        fontWeight: 600,
      },
    },
    components: {
      MuiCard: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          root: {
            borderRadius: 20,
            border: `1px solid ${isLight ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.08)'}`,
            boxShadow: isLight
              ? '0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.02)'
              : '0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.15)',
            backgroundImage: 'none',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            borderRadius: 999,
            textTransform: 'none',
            fontWeight: 600,
            padding: '8px 20px',
            '&.MuiButton-containedPrimary:hover': {
              boxShadow: isLight
                ? '0 2px 6px rgba(11, 87, 208, 0.25)'
                : '0 2px 6px rgba(168, 199, 250, 0.25)',
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            fontWeight: 500,
          },
          filled: {
            backgroundColor: isLight ? '#eef2fd' : '#222938',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 24,
            backgroundImage: 'none',
            border: `1px solid ${isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.1)'}`,
            boxShadow: isLight
              ? '0 12px 36px rgba(0, 0, 0, 0.12)'
              : '0 12px 36px rgba(0, 0, 0, 0.5)',
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: isLight ? '#0b57d0' : '#a8c7fa',
            },
          },
          notchedOutline: {
            borderColor: isLight ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.14)',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            margin: '4px 8px',
            '&.Mui-selected': {
              backgroundColor: isLight ? alpha('#0b57d0', 0.12) : alpha('#a8c7fa', 0.15),
              color: isLight ? '#0b57d0' : '#a8c7fa',
              fontWeight: 600,
              '&:hover': {
                backgroundColor: isLight ? alpha('#0b57d0', 0.18) : alpha('#a8c7fa', 0.22),
              },
              '& .MuiListItemIcon-root': {
                color: isLight ? '#0b57d0' : '#a8c7fa',
              },
            },
          },
        },
      },
      MuiFab: {
        styleOverrides: {
          root: {
            borderRadius: 18,
            boxShadow: isLight
              ? '0 4px 14px rgba(11, 87, 208, 0.3)'
              : '0 4px 14px rgba(0, 0, 0, 0.5)',
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            backgroundColor: isLight ? '#f0f3fa' : '#1d2433',
            padding: 3,
            border: `1px solid ${isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'}`,
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            border: 'none',
            padding: '6px 16px',
            textTransform: 'none',
            fontWeight: 600,
            color: isLight ? '#43474e' : '#8d9199',
            '&.Mui-selected': {
              backgroundColor: isLight ? '#ffffff' : '#2b3447',
              color: isLight ? '#0b57d0' : '#a8c7fa',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
              '&:hover': {
                backgroundColor: isLight ? '#ffffff' : '#2b3447',
              },
            },
          },
        },
      },
    },
  });
}
