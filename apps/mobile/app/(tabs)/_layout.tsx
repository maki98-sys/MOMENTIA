import { Tabs } from 'expo-router';

const inactive = '#8792A5';
const active = '#FFFFFF';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: active,
      tabBarInactiveTintColor: inactive,
      tabBarStyle: { backgroundColor: '#171D28', borderTopColor: '#30394A', height: 62, paddingTop: 7, paddingBottom: 7 },
      tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Social', tabBarLabel: 'Social', tabBarIcon: () => null }} />
      <Tabs.Screen name="events" options={{ title: 'Eventos', tabBarLabel: 'Eventos', tabBarIcon: () => null }} />
      <Tabs.Screen name="couple" options={{ title: 'Pareja', tabBarLabel: 'Pareja', tabBarIcon: () => null }} />
      <Tabs.Screen name="circles" options={{ title: 'Círculos', tabBarLabel: 'Círculos', tabBarIcon: () => null }} />
      <Tabs.Screen name="audio" options={{ title: 'Audio', tabBarLabel: 'Audio', tabBarIcon: () => null }} />
    </Tabs>
  );
}