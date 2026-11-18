import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type ExperienceScreenProps = {
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: string;
  children?: ReactNode;
};

export function ExperienceScreen(props: ExperienceScreenProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>{props.eyebrow}</Text>
      <Text style={styles.title}>{props.title}</Text>
      <Text style={styles.description}>{props.description}</Text>
      {props.children}
      <View style={styles.emptyCard}>
        <Text style={styles.icon}>{props.icon}</Text>
        <Text style={styles.emptyTitle}>{props.emptyTitle}</Text>
        <Text style={styles.emptyDescription}>{props.emptyDescription}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#10131A', paddingHorizontal: 22, paddingTop: 34 },
  eyebrow: { color: '#98A5BA', fontSize: 10, letterSpacing: 2, fontWeight: '700' },
  title: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', marginTop: 10 },
  description: { color: '#AAB4C5', fontSize: 14, lineHeight: 21, marginTop: 8, maxWidth: 330 },
  emptyCard: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A202C', borderColor: '#30394A', borderWidth: 1, borderRadius: 20, padding: 24, marginTop: 28, minHeight: 220 },
  icon: { fontSize: 34, marginBottom: 14 },
  emptyTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyDescription: { color: '#AAB4C5', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 },
});