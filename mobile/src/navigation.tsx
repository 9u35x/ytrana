import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DefaultTheme, type NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useAuth } from './auth';
import { colors } from './theme';
import type { Post } from './types';
import AuthScreen from './screens/AuthScreen';
import FeedScreen from './screens/FeedScreen';
import ExploreScreen from './screens/ExploreScreen';
import CommunityScreen from './screens/CommunityScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import MessagesScreen from './screens/MessagesScreen';
import ProfileScreen from './screens/ProfileScreen';
import ProfileDetailScreen from './screens/ProfileDetailScreen';
import ChatScreen from './screens/ChatScreen';
import CommentsScreen from './screens/CommentsScreen';
import StoriesScreen from './screens/StoriesScreen';
import ReelsScreen from './screens/ReelsScreen';
import AccountSettingsScreen from './screens/AccountSettingsScreen';
import PrivacyPolicyScreen from './screens/PrivacyPolicyScreen';
import AdminScreen from './screens/AdminScreen';
import LiveDemoScreen from './screens/LiveDemoScreen';

export type TabParamList = {
  Feed: undefined;
  Explore: undefined;
  Community: undefined;
  Stories: undefined;
  Reels: { postId?: number } | undefined;
  Notifications: undefined;
  Messages: undefined;
  Profile: undefined;
  Settings: undefined;
  PrivacyPolicy: undefined;
  LiveDemo: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: NavigatorScreenParams<TabParamList> | undefined;
  ProfileDetail: { username: string };
  Chat: { username: string; fullName?: string };
  Comments: { post: Post };
  Admin: undefined;
};

export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
type TabsNavigation = BottomTabNavigationProp<TabParamList>;
type IconName = React.ComponentProps<typeof Ionicons>['name'];
type TabItem = { name: 'Feed' | 'Explore' | 'Community' | 'Reels' | 'Messages' | 'Profile'; title: string; icon: IconName; component: React.ComponentType<any> };

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();
const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: colors.primary, background: colors.background, card: '#FFFFFF', text: colors.ink, border: colors.border },
};

function HeaderActions({ navigation }: { navigation: TabsNavigation }) {
  return <View style={styles.headerActions}>
    <Pressable accessibilityRole="button" accessibilityLabel="الرسائل" onPress={() => navigation.navigate('Messages')} style={styles.headerAction}>
      <Ionicons name="chatbubble-ellipses-outline" size={22} color={colors.primaryDark} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="التنبيهات" onPress={() => navigation.navigate('Notifications')} style={styles.headerAction}>
      <Ionicons name="notifications-outline" size={22} color={colors.primaryDark} />
    </Pressable>
  </View>;
}

function MainTabs() {
  const visibleTabs: TabItem[] = [
    { name: 'Feed', title: 'الرئيسية', icon: 'home-outline', component: FeedScreen },
    { name: 'Explore', title: 'استكشاف', icon: 'compass-outline', component: ExploreScreen },
    { name: 'Community', title: 'المجتمع', icon: 'people-outline', component: CommunityScreen },
    { name: 'Reels', title: 'ريلز', icon: 'play-circle-outline', component: ReelsScreen },
    { name: 'Messages', title: 'الرسائل', icon: 'chatbubbles-outline', component: MessagesScreen },
    { name: 'Profile', title: 'حسابي', icon: 'person-circle-outline', component: ProfileScreen },
  ];

  return <Tabs.Navigator screenOptions={({ navigation }) => ({
    headerShown: true,
    headerTitle: 'Ytrana',
    headerTitleAlign: 'center',
    headerTitleStyle: { color: colors.primaryDark, fontSize: 21, fontWeight: '900' },
    headerStyle: { backgroundColor: '#FFFFFF' },
    headerShadowVisible: false,
    headerRight: () => <HeaderActions navigation={navigation} />,
    headerRightContainerStyle: { paddingRight: 8 },
    headerLeftContainerStyle: { paddingLeft: 8 },
    tabBarStyle: { height: 66, paddingTop: 5, paddingBottom: 5, borderTopColor: colors.border, backgroundColor: '#FFFFFF', elevation: 10 },
    tabBarItemStyle: { paddingVertical: 1 },
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.muted,
    tabBarLabelStyle: { fontSize: 10, fontWeight: '800', marginTop: -1 },
    tabBarHideOnKeyboard: true,
  })}>
    {visibleTabs.map((item) => <Tabs.Screen key={item.name} name={item.name} component={item.component} options={{
      title: item.title,
      tabBarLabel: item.title,
      tabBarIcon: ({ color, focused }) => <Ionicons name={item.icon} size={focused ? 23 : 22} color={color} />,
    }} />)}
    <Tabs.Screen name="Stories" component={StoriesScreen} options={{ title: 'القصص', tabBarButton: () => null, headerShown: false }} />
    <Tabs.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'التنبيهات', tabBarButton: () => null }} />
    <Tabs.Screen name="Settings" component={AccountSettingsScreen} options={{ title: 'الإعدادات والخصوصية', tabBarButton: () => null }} />
    <Tabs.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: 'سياسة الخصوصية', tabBarButton: () => null }} />
    <Tabs.Screen name="LiveDemo" component={LiveDemoScreen} options={{ title: 'Ytrana Live DEMO', tabBarButton: () => null }} />
  </Tabs.Navigator>;
}

export function AppNavigator() {
  const { token, loading } = useAuth();
  if (loading) return <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /><Text style={styles.loadingText}>Ytrana</Text></View>;
  return <NavigationContainer theme={navTheme}>
    <Stack.Navigator screenOptions={{
      headerTintColor: colors.primaryDark,
      headerTitleStyle: { color: colors.ink, fontWeight: '800' },
      headerStyle: { backgroundColor: '#FFFFFF' },
      contentStyle: { backgroundColor: colors.background },
    }}>
      {!token ? <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} /> : <>
        <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="ProfileDetail" component={ProfileDetailScreen} options={{ title: 'الملف الشخصي' }} />
        <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.fullName || `@${route.params.username}` })} />
        <Stack.Screen name="Comments" component={CommentsScreen} options={{ title: 'التعليقات' }} />
        <Stack.Screen name="Admin" component={AdminScreen} options={{ title: 'لوحة الإدارة' }} />
      </>}
    </Stack.Navigator>
  </NavigationContainer>;
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  headerAction: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.soft },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: colors.primaryDark, fontSize: 18, fontWeight: '900' },
});
