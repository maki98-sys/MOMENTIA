import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { ExperienceScreen } from '../../src/components/experience-screen';

export default function SocialScreen() {
  return <ExperienceScreen
    eyebrow="MOMENTIA / SOCIAL"
    title="Tu mundo en imágenes"
    description="Comparte momentos, descubre historias y mantente cerca de las personas que te importan."
    icon="✦"
    emptyTitle="Tu feed está listo para comenzar"
    emptyDescription="Aquí aparecerán las publicaciones de las personas y comunidades que sigas. La creación de publicaciones y las interacciones se conectarán en la siguiente etapa."
  >
    <Link href="/capture" asChild>
      <Pressable style={styles.captureButton}>
        <Text style={styles.captureText}>＋  Capturar un recuerdo</Text>
      </Pressable>
    </Link>
  </ExperienceScreen>;
}

const styles = StyleSheet.create({
  captureButton: { backgroundColor: '#FFFFFF', borderRadius: 13, padding: 15, alignItems: 'center', marginTop: 22 },
  captureText: { color: '#10131A', fontWeight: '800' },
});
