import {StyleSheet} from 'react-native';
import {Theme} from '../../../../utils/types';
import {EdgeInsets} from 'react-native-safe-area-context';

export const createStyles = (theme: Theme, insets: EdgeInsets) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.outline,
    },
    actionBar: {
      flexDirection: 'row',
      paddingHorizontal: 8,
      paddingVertical: 8,
      paddingBottom: Math.max(insets.bottom, 12),
      // Left-aligned group: with the account button gone, space-around pushed
      // Add Pal to the far right edge.
      justifyContent: 'flex-start',
      gap: 12,
      alignItems: 'center',
      minHeight: 70,
    },
    actionButton: {
      minWidth: 72,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderRadius: 12,
    },
    iconContainer: {
      marginBottom: 4,
      padding: 4,
    },
    actionLabel: {
      fontSize: 11,
      fontWeight: '500',
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
    },
  });
