import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { api } from '../src/api/client';
import { getLocalDatabase } from '../src/storage/database';

type ServiceState = 'checking' | 'online' | 'offline';

export default function HomeScreen() {
  const [serviceState, setServiceState] = useState<ServiceState>('checking');
  const [localReady, setLocalReady] = useState(false);

  useEffect(() => {
    let active = true;
    void getLocalDatabase()
      .then(() => { if (active) setLocalReady(true); })
      .catch(() => { if (active) setLocalReady(false); });
    void api.health()
      .then(() => { if (active) setServiceState('online'); })
      .catch(() => { if (active) setServiceState('offline'); });
    return () => { active = false; };
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.content}>
        <Text style={styles.eyebrow}>TUS RECUERDOS, CONECTADOS</Text>
        <Text style={styles.logo}>MOMENTIA</Text>
        <Text style={styles.subtitle}>Cada momento merece quedarse.</Text>
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Estado de la aplicación</Text>
          <Status label="Base local" value={localReady ? 'Preparada' : 'Inicializando'} />
          <Status label="Servidor" value={serviceState === 'online' ? 'Conectado' : serviceState === 'offline' ? 'Sin conexión' : 'Comprobando'} />
        </View>
        <Link href="/(tabs)" asChild>
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>Entrar a MOMENTIA</Text>
          </Pressable>
        </Link>
        <Text style={styles.note}>Estamos preparando tu espacio. Tus operaciones pendientes se conservarán localmente cuando activemos la sincronización.</Text>
      </View>
    </SafeAreaView>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={styles.statusValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#10131A' },
  content: { flex: 1, paddingHorizontal: 26, paddingTop: 70 },
  eyebrow: { color: '#9EA8BC', fontSize: 11, letterSpacing: 2.4, fontWeight: '700' },
  logo: { color: '#FFFFFF', fontSize: 38, fontWeight: '800', letterSpacing: 1.5, marginTop: 12 },
  subtitle: { color: '#B8C0CF', fontSize: 16, marginTop: 8 },
  panel: { backgroundColor: '#1A202C', borderRadius: 20, padding: 20, marginTop: 44, borderWidth: 1, borderColor: '#30394A' },
  panelTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 18 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  statusLabel: { color: '#AAB4C5', fontSize: 14 },
  statusValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  button: { backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#10131A', fontSize: 14, fontWeight: '800' },
  note: { color: '#8D98AA', fontSize: 13, lineHeight: 20, marginTop: 22 },
});