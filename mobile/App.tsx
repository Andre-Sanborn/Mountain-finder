/**
 * Mountain Finder — the mobile shell (P8.1).
 *
 * Two screens, no navigation library, no state management, no data layer. The
 * shell's entire job is to put a device's sensors in front of the pure modules
 * in `/src/live` and `/src/core`, which it imports **unchanged** across the
 * repository root — that is P8.1's bar, and there is no copy of them here to
 * drift out of sync.
 *
 * Read `mobile/README.md` for what this can and cannot prove.
 */

import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import type { ModelDeclinationInput } from '../src/live/heading-policy';
import { CalibrateScreen } from './src/CalibrateScreen';
import { HorizonScreen } from './src/HorizonScreen';
import { colors, styles } from './src/theme';
import { useDeviceSensors } from './src/useDeviceSensors';

type Tab = 'calibrate' | 'horizon';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'calibrate', label: 'Calibrate' },
  { id: 'horizon', label: 'Horizon' },
];

/**
 * How far the phone moves, and how long it waits, before asking for a new fix.
 *
 * Declination changes by well under a tenth of a degree over a kilometre, and
 * its secular drift is a few hundredths of a degree a year. So a coarse fix,
 * refreshed rarely, is as good as a precise one, and it costs far less battery.
 */
const FIX_DISTANCE_INTERVAL_M = 1000;
const FIX_TIME_INTERVAL_MS = 60_000;

export default function App() {
  const [tab, setTab] = useState<Tab>('calibrate');
  // No declination is supplied by hand. Supplying a guess would make magnetic
  // headings silently "true", which is the one thing the EXIF path refuses to
  // do; iOS resolves true north itself when it has a fix.
  const sensors = useDeviceSensors(undefined);

  // Position and date for the WMM2025 field model. When the phone has a fix,
  // `heading-policy.ts` converts a magnetic-only bearing to true north and
  // labels it `true-model`; without one it falls back to the labelled MAG
  // bearing. The date is the fix's own timestamp, so nothing downstream reads
  // a clock.
  const [modelDeclination, setModelDeclination] = useState<ModelDeclinationInput | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | undefined;

    void (async () => {
      try {
        // Already requested by `useDeviceSensors` for the compass; asking again
        // returns the existing grant without a second prompt.
        const permission = await Location.requestForegroundPermissionsAsync();
        if (cancelled || !permission.granted) return;
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: FIX_DISTANCE_INTERVAL_M,
            timeInterval: FIX_TIME_INTERVAL_MS,
          },
          (fix) => {
            setModelDeclination({
              site: {
                latitudeDeg: fix.coords.latitude,
                longitudeDeg: fix.coords.longitude,
                // The model wants height above the ellipsoid. A missing
                // altitude costs far less than the model's own 0.5° error.
                heightM: fix.coords.altitude ?? 0,
              },
              when: new Date(fix.timestamp),
            });
          },
        );
      } catch {
        // No fix, so no model. The overlay still draws, labelled MAG.
        if (!cancelled) setModelDeclination(undefined);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={{ flex: 1 }}>
          {tab === 'calibrate' ? (
            <CalibrateScreen sensors={sensors} />
          ) : (
            <HorizonScreen sensors={sensors} modelDeclination={modelDeclination} />
          )}
        </View>
        <View style={styles.tabBar}>
          {TABS.map((entry) => (
            <Pressable key={entry.id} style={styles.tab} onPress={() => setTab(entry.id)}>
              <Text
                style={[
                  styles.tabLabel,
                  { color: tab === entry.id ? colors.accent : colors.dim },
                ]}
              >
                {entry.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
