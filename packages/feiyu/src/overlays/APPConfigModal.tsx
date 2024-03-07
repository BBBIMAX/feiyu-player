import { useXConsumer, useXProvider, XSta } from 'xsta';

import { Box } from '@/components/Box';
import { Dialog } from '@/components/Dialog';
import { Text } from '@/components/Text';
import { usePages } from '@/services/routes/page';

const kAPPModals = 'kAPPModals';
interface APPModals {
  showAPPConfig: boolean;
}

export const setAPPModals = (option: Partial<APPModals>) => {
  XSta.set(kAPPModals, {
    ...(XSta.get(kAPPModals) ?? {}),
    ...option,
  });
};

const _initAPPModalStates = {
  showAPPConfig: false,
};
export const useInitAPPModals = () => {
  useXProvider<APPModals>(kAPPModals, _initAPPModalStates);
};

export const showAPPConfigModal = (flag = true) => {
  setAPPModals({
    ..._initAPPModalStates,
    showAPPConfig: flag,
  });
};

export const APPConfigModal = () => {
  const [data] = useXConsumer<APPModals>(kAPPModals);
  const { showAPPConfig } = data ?? {};
  const { jumpToPage } = usePages();
  const closeModal = () => {
    showAPPConfigModal(false);
  };
  return (
    <Dialog
      visible={showAPPConfig}
      title="💡 提示"
      ok="设置"
      onOk={() => {
        closeModal();
        jumpToPage('settings'); // 点击打开设置页面
      }}
      cancel="取消"
      onCancel={closeModal}
    >
      <Box marginBottom="16px">
        <Text
          maxHeight="400px"
          overflowY="scroll"
          fontSize="14px"
          lineHeight="24px"
          className="hide-scrollbar"
        >
          请先打开设置，配置请求代理
        </Text>
      </Box>
    </Dialog>
  );
};
