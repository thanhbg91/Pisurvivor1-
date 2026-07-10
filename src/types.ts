export interface PiUser {
  uid: string;
  username: string;
}

export interface PiAuth {
  accessToken: string;
  user: PiUser;
}

export interface PiPayment {
  identifier: string;
  amount: number;
  memo: string;
  metadata: any;
  transaction?: {
    txid: string;
  };
}

export interface PiSDK {
  init(config: { version: string; sandbox: boolean }): void;
  authenticate(
    scopes: string[],
    onIncompletePaymentFound: (payment: PiPayment) => void
  ): Promise<PiAuth>;
  createPayment(
    paymentData: {
      amount: number;
      memo: string;
      metadata: Record<string, any>;
    },
    callbacks: {
      onReadyForServerApproval: (paymentId: string) => void;
      onReadyForServerCompletion: (paymentId: string, txid: string) => void;
      onCancel: (paymentId: string) => void;
      onError: (error: Error, payment?: PiPayment) => void;
    }
  ): void;
}

declare global {
  interface Window {
    Pi?: PiSDK;
  }
}
