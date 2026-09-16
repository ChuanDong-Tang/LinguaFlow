package com.yueyantech.oio.alipay

import com.alipay.sdk.app.PayTask
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class OioAlipayPayModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OioAlipayPay")

    AsyncFunction("pay") { orderString: String ->
      if (orderString.isBlank()) {
        throw IllegalArgumentException("Alipay order string is empty")
      }
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val result = PayTask(activity).payV2(orderString, true)
      mapOf(
        "resultStatus" to result["resultStatus"],
        "memo" to result["memo"],
        "result" to result["result"],
      )
    }
  }
}
