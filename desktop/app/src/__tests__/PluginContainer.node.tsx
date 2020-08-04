/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import React from 'react';
import produce from 'immer';
import {FlipperPlugin} from '../plugin';
import {renderMockFlipperWithPlugin} from '../test-utils/createMockFlipperWithPlugin';
import {
  SandyPluginDefinition,
  FlipperClient,
  TestUtils,
  usePlugin,
  createState,
  DevicePluginClient,
  DeviceLogEntry,
  useValue,
} from 'flipper-plugin';
import {selectPlugin, starPlugin} from '../reducers/connections';
import {updateSettings} from '../reducers/settings';

interface PersistedState {
  count: 1;
}

class TestPlugin extends FlipperPlugin<any, any, any> {
  static id = 'TestPlugin';

  static defaultPersistedState = {
    count: 0,
  };

  static persistedStateReducer(
    persistedState: PersistedState,
    method: string,
    payload: {delta?: number},
  ) {
    return produce(persistedState, (draft) => {
      if (method === 'inc') {
        draft.count += payload?.delta || 1;
      }
    });
  }

  render() {
    return (
      <h1>
        Hello:{' '}
        <span data-testid="counter">{this.props.persistedState.count}</span>
      </h1>
    );
  }
}

test('Plugin container can render plugin and receive updates', async () => {
  const {renderer, sendMessage, act} = await renderMockFlipperWithPlugin(
    TestPlugin,
  );
  expect(renderer.baseElement).toMatchInlineSnapshot(`
        <body>
          <div>
            <div
              class="css-1orvm1g-View-FlexBox-FlexColumn"
            >
              <h1>
                Hello:
                 
                <span
                  data-testid="counter"
                >
                  0
                </span>
              </h1>
            </div>
            <div
              class="css-bxcvv9-View-FlexBox-FlexRow"
              id="detailsSidebar"
            />
          </div>
        </body>
      `);

  act(() => {
    sendMessage('inc', {delta: 2});
  });

  expect((await renderer.findByTestId('counter')).textContent).toBe('2');
});

test('PluginContainer can render Sandy plugins', async () => {
  let renders = 0;

  function MySandyPlugin() {
    renders++;
    const sandyApi = usePlugin(plugin);
    expect(Object.keys(sandyApi)).toEqual([
      'connectedStub',
      'disconnectedStub',
    ]);
    expect(() => {
      // eslint-disable-next-line
      usePlugin(function bla() {
        return {};
      });
    }).toThrowError(/didn't match the type of the requested plugin/);
    return <div>Hello from Sandy</div>;
  }

  const plugin = (client: FlipperClient) => {
    const connectedStub = jest.fn();
    const disconnectedStub = jest.fn();
    client.onConnect(connectedStub);
    client.onDisconnect(disconnectedStub);
    return {connectedStub, disconnectedStub};
  };

  const definition = new SandyPluginDefinition(
    TestUtils.createMockPluginDetails(),
    {
      plugin,
      Component: MySandyPlugin,
    },
  );
  const {
    renderer,
    act,
    sendMessage,
    client,
    store,
  } = await renderMockFlipperWithPlugin(definition);

  expect(client.rawSend).toBeCalledWith('init', {plugin: 'TestPlugin'});

  expect(renderer.baseElement).toMatchInlineSnapshot(`
        <body>
          <div>
            <div
              class="css-1orvm1g-View-FlexBox-FlexColumn"
            >
              <div>
                Hello from Sandy
              </div>
            </div>
            <div
              class="css-bxcvv9-View-FlexBox-FlexRow"
              id="detailsSidebar"
            />
          </div>
        </body>
      `);
  expect(renders).toBe(1);

  // sending a new message doesn't cause a re-render
  act(() => {
    sendMessage('inc', {delta: 2});
  });
  expect(renders).toBe(1);

  // make sure the plugin gets connected
  const pluginInstance: ReturnType<typeof plugin> = client.sandyPluginStates.get(
    definition.id,
  )!.instanceApi;
  expect(pluginInstance.connectedStub).toBeCalledTimes(1);
  expect(pluginInstance.disconnectedStub).toBeCalledTimes(0);

  // select non existing plugin
  act(() => {
    store.dispatch(
      selectPlugin({
        selectedPlugin: 'Logs',
        deepLinkPayload: null,
      }),
    );
  });

  expect(client.rawSend).toBeCalledWith('deinit', {plugin: 'TestPlugin'});

  expect(renderer.baseElement).toMatchInlineSnapshot(`
    <body>
      <div />
    </body>
  `);
  expect(pluginInstance.connectedStub).toBeCalledTimes(1);
  expect(pluginInstance.disconnectedStub).toBeCalledTimes(1);

  // go back
  act(() => {
    store.dispatch(
      selectPlugin({
        selectedPlugin: definition.id,
        deepLinkPayload: null,
      }),
    );
  });
  expect(pluginInstance.connectedStub).toBeCalledTimes(2);
  expect(pluginInstance.disconnectedStub).toBeCalledTimes(1);
  expect(client.rawSend).toBeCalledWith('init', {plugin: 'TestPlugin'});

  // disable
  act(() => {
    store.dispatch(
      starPlugin({
        plugin: definition,
        selectedApp: client.query.app,
      }),
    );
  });
  expect(pluginInstance.connectedStub).toBeCalledTimes(2);
  expect(pluginInstance.disconnectedStub).toBeCalledTimes(2);
  expect(client.rawSend).toBeCalledWith('deinit', {plugin: 'TestPlugin'});

  // re-enable
  act(() => {
    store.dispatch(
      starPlugin({
        plugin: definition,
        selectedApp: client.query.app,
      }),
    );
  });
  // note: this is the old pluginInstance, so that one is not reconnected!
  expect(pluginInstance.connectedStub).toBeCalledTimes(2);
  expect(pluginInstance.disconnectedStub).toBeCalledTimes(2);

  expect(
    client.sandyPluginStates.get('TestPlugin')!.instanceApi.connectedStub,
  ).toBeCalledTimes(1);
  expect(client.rawSend).toBeCalledWith('init', {plugin: 'TestPlugin'});
});

test('PluginContainer + Sandy plugin supports deeplink', async () => {
  const linksSeen: any[] = [];

  const plugin = (client: FlipperClient) => {
    const linkState = createState('');
    client.onDeepLink((link) => {
      linksSeen.push(link);
      linkState.set(String(link));
    });
    return {
      linkState,
    };
  };

  const definition = new SandyPluginDefinition(
    TestUtils.createMockPluginDetails(),
    {
      plugin,
      Component() {
        const instance = usePlugin(plugin);
        const linkState = useValue(instance.linkState);
        return <h1>hello {linkState || 'world'}</h1>;
      },
    },
  );
  const {renderer, act, client, store} = await renderMockFlipperWithPlugin(
    definition,
  );

  expect(client.rawSend).toBeCalledWith('init', {plugin: 'TestPlugin'});

  expect(linksSeen).toEqual([]);
  expect(renderer.baseElement).toMatchInlineSnapshot(`
    <body>
      <div>
        <div
          class="css-1orvm1g-View-FlexBox-FlexColumn"
        >
          <h1>
            hello 
            world
          </h1>
        </div>
        <div
          class="css-bxcvv9-View-FlexBox-FlexRow"
          id="detailsSidebar"
        />
      </div>
    </body>
  `);

  act(() => {
    store.dispatch(
      selectPlugin({
        selectedPlugin: definition.id,
        deepLinkPayload: 'universe!',
        selectedApp: client.query.app,
      }),
    );
  });

  expect(linksSeen).toEqual(['universe!']);
  expect(renderer.baseElement).toMatchInlineSnapshot(`
    <body>
      <div>
        <div
          class="css-1orvm1g-View-FlexBox-FlexColumn"
        >
          <h1>
            hello 
            universe!
          </h1>
        </div>
        <div
          class="css-bxcvv9-View-FlexBox-FlexRow"
          id="detailsSidebar"
        />
      </div>
    </body>
  `);

  // Sending same link doesn't trigger again
  act(() => {
    store.dispatch(
      selectPlugin({
        selectedPlugin: definition.id,
        deepLinkPayload: 'universe!',
        selectedApp: client.query.app,
      }),
    );
  });
  expect(linksSeen).toEqual(['universe!']);

  // ...nor does a random other store update that does trigger a plugin container render
  act(() => {
    store.dispatch(
      updateSettings({
        ...store.getState().settingsState,
      }),
    );
  });
  expect(linksSeen).toEqual(['universe!']);

  // Different link does trigger again
  act(() => {
    store.dispatch(
      selectPlugin({
        selectedPlugin: definition.id,
        deepLinkPayload: 'london!',
        selectedApp: client.query.app,
      }),
    );
  });
  expect(linksSeen).toEqual(['universe!', 'london!']);

  // and same link does trigger if something else was selected in the mean time
  act(() => {
    store.dispatch(
      selectPlugin({
        selectedPlugin: 'Logs',
        deepLinkPayload: 'london!',
        selectedApp: client.query.app,
      }),
    );
  });
  act(() => {
    store.dispatch(
      selectPlugin({
        selectedPlugin: definition.id,
        deepLinkPayload: 'london!',
        selectedApp: client.query.app,
      }),
    );
  });
  expect(linksSeen).toEqual(['universe!', 'london!', 'london!']);
});

test('PluginContainer can render Sandy device plugins', async () => {
  let renders = 0;

  function MySandyPlugin() {
    renders++;
    const sandyApi = usePlugin(devicePlugin);
    expect(Object.keys(sandyApi)).toEqual([
      'activatedStub',
      'deactivatedStub',
      'lastLogMessage',
    ]);
    expect(() => {
      // eslint-disable-next-line
      usePlugin(function bla() {
        return {};
      });
    }).toThrowError(/didn't match the type of the requested plugin/);
    const lastLogMessage = useValue(sandyApi.lastLogMessage);
    return <div>Hello from Sandy: {lastLogMessage?.message}</div>;
  }

  const devicePlugin = (client: DevicePluginClient) => {
    const lastLogMessage = createState<undefined | DeviceLogEntry>(undefined);
    const activatedStub = jest.fn();
    const deactivatedStub = jest.fn();
    client.onActivate(activatedStub);
    client.onDeactivate(deactivatedStub);
    client.device.onLogEntry((e) => {
      lastLogMessage.set(e);
    });
    return {activatedStub, deactivatedStub, lastLogMessage};
  };

  const definition = new SandyPluginDefinition(
    TestUtils.createMockPluginDetails(),
    {
      supportsDevice: () => true,
      devicePlugin,
      Component: MySandyPlugin,
    },
  );
  // any cast because this plugin is not enriched with the meta data that the plugin loader
  // normally adds. Our further sandy plugin test infra won't need this, but
  // for this test we do need to act a s a loaded plugin, to make sure PluginContainer itself can handle it
  const {renderer, act, store, device} = await renderMockFlipperWithPlugin(
    definition,
  );

  expect(renderer.baseElement).toMatchInlineSnapshot(`
    <body>
      <div>
        <div
          class="css-1orvm1g-View-FlexBox-FlexColumn"
        >
          <div>
            Hello from Sandy: 
          </div>
        </div>
        <div
          class="css-bxcvv9-View-FlexBox-FlexRow"
          id="detailsSidebar"
        />
      </div>
    </body>
  `);
  expect(renders).toBe(1);

  act(() => {
    device.addLogEntry({
      date: new Date(),
      message: 'helleuh',
      pid: 0,
      tid: 0,
      type: 'info',
      tag: 'test',
    });
  });
  expect(renders).toBe(2);

  expect(renderer.baseElement).toMatchInlineSnapshot(`
    <body>
      <div>
        <div
          class="css-1orvm1g-View-FlexBox-FlexColumn"
        >
          <div>
            Hello from Sandy: 
            helleuh
          </div>
        </div>
        <div
          class="css-bxcvv9-View-FlexBox-FlexRow"
          id="detailsSidebar"
        />
      </div>
    </body>
  `);

  // make sure the plugin gets connected
  const pluginInstance: ReturnType<typeof devicePlugin> = device.sandyPluginStates.get(
    definition.id,
  )!.instanceApi;
  expect(pluginInstance.activatedStub).toBeCalledTimes(1);
  expect(pluginInstance.deactivatedStub).toBeCalledTimes(0);

  // select non existing plugin
  act(() => {
    store.dispatch(
      selectPlugin({
        selectedPlugin: 'Logs',
        deepLinkPayload: null,
      }),
    );
  });

  expect(renderer.baseElement).toMatchInlineSnapshot(`
    <body>
      <div />
    </body>
  `);
  expect(pluginInstance.activatedStub).toBeCalledTimes(1);
  expect(pluginInstance.deactivatedStub).toBeCalledTimes(1);

  // go back
  act(() => {
    store.dispatch(
      selectPlugin({
        selectedPlugin: definition.id,
        deepLinkPayload: null,
      }),
    );
  });
  expect(pluginInstance.activatedStub).toBeCalledTimes(2);
  expect(pluginInstance.deactivatedStub).toBeCalledTimes(1);
});
