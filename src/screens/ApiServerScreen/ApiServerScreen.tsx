import React, {useCallback, useContext, useEffect, useState} from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {observer} from 'mobx-react';
import {
  ActivityIndicator,
  Button,
  Divider,
  Switch,
  Text,
} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';

import {GlobeIcon} from '../../assets/icons';
import {useTheme} from '../../hooks';
import {
  API_SERVER_PORT,
  getState,
  isRunning,
  start,
  stop,
  syncState,
} from '../../services/apiServer';
import {modelStore} from '../../store';
import {L10nContext} from '../../utils';
import {t} from '../../locales';
import type {Theme} from '../../utils/types';

/**
 * LAN API server: serves the model loaded in the app to other devices.
 *
 * The screen exists mostly to tell you two things you cannot guess: the address
 * to point a client at, and whether a model is loaded at all (without one every
 * completion answers 503).
 */
export const ApiServerScreen: React.FC = observer(() => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const copy = l10n.apiServer;
  const styles = createStyles(theme);

  const [running, setRunning] = useState(isRunning());
  const [urls, setUrls] = useState<string[]>(getState().urls);
  const [port, setPort] = useState<number>(getState().port || API_SERVER_PORT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    syncState()
      .then(info => {
        setRunning(info.running);
        setUrls(info.urls);
        setPort(info.port || API_SERVER_PORT);
      })
      .catch(() => {});
  }, []);

  const toggle = useCallback(async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (next) {
        const info = await start(API_SERVER_PORT);
        setRunning(true);
        setUrls(info.urls);
        setPort(info.port);
      } else {
        await stop();
        setRunning(false);
        setUrls([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    } finally {
      setBusy(false);
    }
  }, []);

  const primaryUrl = urls[0];
  const modelName = modelStore.activeModel?.name;

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <GlobeIcon width={26} height={26} stroke={theme.colors.primary} />
          <Text variant="titleMedium" style={styles.title}>
            {copy.title}
          </Text>
          {busy ? <ActivityIndicator size={18} /> : null}
        </View>

        <Text style={styles.description}>{copy.description}</Text>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text variant="bodyLarge">{copy.enable}</Text>
            <Text style={styles.rowHint}>
              {running ? t(copy.listening, {port: String(port)}) : copy.stopped}
            </Text>
          </View>
          <Switch
            value={running}
            onValueChange={toggle}
            disabled={busy}
            testID="api-server-switch"
          />
        </View>

        <Divider />

        <View style={styles.section}>
          <Text variant="bodyLarge">{copy.address}</Text>
          {urls.length === 0 ? (
            <Text style={styles.rowHint}>
              {running ? copy.noAddressRunning : copy.noAddressStopped}
            </Text>
          ) : (
            urls.map(url => (
              <TouchableOpacity
                key={url}
                style={styles.urlRow}
                onPress={() => Clipboard.setString(url)}>
                <Text style={styles.url}>{url}</Text>
                <Text style={styles.copyHint}>{copy.tapToCopy}</Text>
              </TouchableOpacity>
            ))
          )}
          {primaryUrl ? (
            <Button
              mode="contained"
              icon="open-in-new"
              style={styles.button}
              onPress={() => Linking.openURL(primaryUrl).catch(() => {})}>
              {copy.openPage}
            </Button>
          ) : null}
        </View>

        <Divider />

        <View style={styles.section}>
          <Text variant="bodyLarge">{copy.endpoints}</Text>
          <Text style={styles.mono}>GET /v1/models</Text>
          <Text style={styles.mono}>
            POST /v1/chat/completions (stream: true)
          </Text>
          <Text style={styles.mono}>GET /health</Text>
          <Text style={styles.rowHint}>
            {t(copy.clientHint, {
              baseUrl: primaryUrl ? `${primaryUrl}/v1` : 'http://<IP>:8080/v1',
            })}
          </Text>
        </View>

        <Divider />

        <View style={styles.section}>
          <Text variant="bodyLarge">{copy.model}</Text>
          <Text style={modelName ? styles.mono : styles.rowHint}>
            {modelName ?? copy.noModel}
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: theme.colors.background},
    content: {padding: 16, gap: 14, paddingBottom: 40},
    headerRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
    title: {flex: 1, fontWeight: '600'},
    description: {color: theme.colors.onSurfaceVariant, lineHeight: 20},
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    rowText: {flex: 1, gap: 2},
    rowHint: {color: theme.colors.onSurfaceVariant, fontSize: 13},
    section: {gap: 8},
    urlRow: {
      backgroundColor: theme.colors.inverseOnSurface,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 2,
    },
    url: {fontFamily: 'monospace', fontSize: 14},
    copyHint: {color: theme.colors.onSurfaceVariant, fontSize: 11},
    mono: {fontFamily: 'monospace', fontSize: 13},
    button: {marginTop: 6, alignSelf: 'flex-start'},
    error: {color: theme.colors.error},
  });
