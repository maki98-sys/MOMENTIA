import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { listMediaDrafts, MediaDraft, saveMediaDraft } from '../src/storage/media-drafts';
import { syncPendingMedia } from '../src/storage/media-sync';

export default function CaptureScreen() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<MediaDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const refresh = useCallback(async () => {
    try { setDrafts(await listMediaDrafts()); }
    catch { Alert.alert('Almacenamiento', 'No se pudieron cargar tus recuerdos locales.'); }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const synchronize = async () => {
    try {
      setBusy(true);
      setSyncMessage('Preparando fotografías…');
      const results = await syncPendingMedia();
      const uploaded = results.filter(item => item.state === 'SYNCED').length;
      const failed = results.filter(item => item.state === 'FAILED').length;
      setSyncMessage(`${uploaded} fotografía(s) enviada(s); ${failed} con error. Los archivos enviados quedan en cuarentena hasta su revisión.`);
      await refresh();
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'No se pudo iniciar la sincronización.');
    } finally {
      setBusy(false);
    }
  };

  const capture = async (source: 'camera' | 'library') => {
    try {
      setBusy(true);
      const permission = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permiso necesario', source === 'camera' ? 'Autoriza la cámara para tomar una foto.' : 'Autoriza el acceso a tus fotos para elegir una imagen.');
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9, allowsMultipleSelection: false });
      if (result.canceled || !result.assets[0]) return;
      await saveMediaDraft(result.assets[0]);
      await refresh();
      Alert.alert('Guardado en este dispositivo', 'La fotografía está guardada localmente. Todavía no se ha subido a MOMENTIA.');
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : 'Inténtalo nuevamente.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()}><Text style={styles.back}>‹  Volver</Text></Pressable>
        <Text style={styles.eyebrow}>MOMENTIA / CAPTURA</Text>
        <Text style={styles.title}>Guardar un momento</Text>
        <Text style={styles.subtitle}>Toma una fotografía o elige una de tu galería. Se conservará en el almacenamiento privado de este dispositivo.</Text>
        <View style={styles.actions}>
          <Pressable disabled={busy} style={styles.primary} onPress={() => void capture('camera')}>
            <Text style={styles.primaryText}>Abrir cámara</Text>
          </Pressable>
          <Pressable disabled={busy} style={styles.secondary} onPress={() => void capture('library')}>
            <Text style={styles.secondaryText}>Elegir de galería</Text>
          </Pressable>
        </View>
        {busy ? <ActivityIndicator color="#FFFFFF" style={{ marginTop: 18 }} /> : null}
        <Pressable disabled={busy || drafts.every(item => item.sync_state === 'SYNCED')} style={styles.syncButton} onPress={() => void synchronize()}>
          <Text style={styles.primaryText}>{busy ? 'Procesando…' : 'Sincronizar fotografías pendientes'}</Text>
        </Pressable>
        {syncMessage ? <Text style={styles.syncMessage}>{syncMessage}</Text> : null}
        <Text style={styles.sectionTitle}>Mis recuerdos ({drafts.length})</Text>
        {drafts.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Todavía no hay fotografías</Text>
            <Text style={styles.emptyText}>Tus capturas aparecerán aquí antes de que implementemos la carga y sincronización con el servidor.</Text>
          </View>
        ) : (
          <View style={styles.gallery}>
            {drafts.map(item => (
              <View key={item.draft_id} style={styles.photoCard}>
                <Image source={{ uri: item.local_uri }} style={styles.photo} />
                <Text style={styles.photoName} numberOfLines={1}>{item.file_name}</Text>
                <Text style={item.sync_state === 'SYNCED' ? styles.syncedLabel : styles.localLabel}>{item.sync_state === 'SYNCED' ? 'ENVIADA · EN CUARENTENA' : item.sync_state === 'FAILED' ? 'ERROR · PENDIENTE DE REINTENTO' : 'SOLO EN ESTE DISPOSITIVO'}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#10131A' },
  content: { padding: 22, paddingBottom: 44 },
  back: { color: '#B8C0CF', fontSize: 15, marginBottom: 28 },
  eyebrow: { color: '#98A5BA', fontSize: 10, letterSpacing: 2, fontWeight: '700' },
  title: { color: '#FFFFFF', fontSize: 29, fontWeight: '800', marginTop: 10 },
  subtitle: { color: '#AAB4C5', fontSize: 14, lineHeight: 21, marginTop: 8 },
  actions: { gap: 12, marginTop: 26 },
  primary: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 14, alignItems: 'center' },
  primaryText: { color: '#10131A', fontWeight: '800' },
  secondary: { backgroundColor: '#1A202C', borderColor: '#394457', borderWidth: 1, padding: 16, borderRadius: 14, alignItems: 'center' },
  secondaryText: { color: '#FFFFFF', fontWeight: '700' },
  syncButton: { backgroundColor: '#D6E4FF', padding: 15, borderRadius: 14, alignItems: 'center', marginTop: 16 },
  syncMessage: { color: '#C7D1E0', fontSize: 12, lineHeight: 18, marginTop: 10 },
  sectionTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', marginTop: 28, marginBottom: 14 },
  empty: { backgroundColor: '#1A202C', borderRadius: 18, borderWidth: 1, borderColor: '#30394A', padding: 22 },
  emptyTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  emptyText: { color: '#AAB4C5', fontSize: 13, lineHeight: 20, marginTop: 8 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photoCard: { width: '47%', backgroundColor: '#1A202C', borderRadius: 14, padding: 8, borderColor: '#30394A', borderWidth: 1 },
  photo: { width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: '#252D3B' },
  photoName: { color: '#FFFFFF', fontSize: 11, marginTop: 8 },
  localLabel: { color: '#E5C27B', fontSize: 9, fontWeight: '800', marginTop: 5, letterSpacing: 0.5 },
  syncedLabel: { color: '#9BC7A5', fontSize: 9, fontWeight: '800', marginTop: 5, letterSpacing: 0.4 },
});
