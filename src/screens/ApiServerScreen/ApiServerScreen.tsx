import React, {useCallback, useEffect, useState} from 'react';
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
            API server
          </Text>
          {busy ? <ActivityIndicator size={18} /> : null}
        </View>

        <Text style={styles.description}>
          Serves the model loaded in this app over HTTP, so other devices on the
          same Wi-Fi can use it — OpenAI-compatible endpoints plus a small chat
          page in the browser. Keep the app open while it is in use.
        </Text>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text variant="bodyLarge">Enable</Text>
            <Text style={styles.rowHint}>
              {running
                ? `Listening on port ${port}`
                : 'Stopped — nothing is listening'}
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
          <Text variant="bodyLarge">Address</Text>
          {urls.length === 0 ? (
            <Text style={styles.rowHint}>
              {running
                ? 'No LAN IPv4 address found — is Wi-Fi connected?'
                : 'Turn the server on to see its address'}
            </Text>
          ) : (
            urls.map(url => (
              <TouchableOpacity
                key={url}
                style={styles.urlRow}
                onPress={() => {
                  Clipboard.setString(url);
                }}>
                <Text style={styles.url}>{url}</Text>
                <Text style={styles.copyHint}>tap to copy</Text>
              </TouchableOpacity>
            ))
          )}
          {primaryUrl ? (
            <Button
              mode="contained"
              icon="open-in-new"
              style={styles.button}
              onPress={() => Linking.openURL(primaryUrl).catch(() => {})}>
              Open the chat page
            </Button>
          ) : null}
        </View>

        <Divider />

        <View style={styles.section}>
          <Text variant="bodyLarge">Endpoints</Text>
          <Text style={styles.mono}>GET /v1/models</Text>
          <Text style={styles.mono}>
            POST /v1/chat/completions (stream supported)
          </Text>
          <Text style={styles.mono}>GET /health</Text>
          <Text style={styles.rowHint}>
            Point any OpenAI-compatible client at
            {primaryUrl
              ? ` ${primaryUrl}/v1`
              : ' http://<phone-ip>:8080/v1'}{' '}
            with any API key string.
          </Text>
        </View>

        <Divider />

        <View style={styles.section}>
          <Text variant="bodyLarge">Model</Text>
          <Text style={modelName ? styles.mono : styles.rowHint}>
            {modelName ?? 'No model loaded — requests will answer 503'}
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
