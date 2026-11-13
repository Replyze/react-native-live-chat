// The Quickstart from the README, as a whole app. To run it, point index.js
// at this file instead of App.tsx.
import { Button, View } from 'react-native';
import { Replyze, ReplyzeHost } from '@replyze/react-native';

Replyze.configure({ widgetToken: 'wgt_YOUR_TOKEN' });

export default function App() {
  return (
    <View style={{ flex: 1, justifyContent: 'center' }}>
      <Button title="Chat with us" onPress={() => Replyze.show()} />
      <ReplyzeHost />
    </View>
  );
}
