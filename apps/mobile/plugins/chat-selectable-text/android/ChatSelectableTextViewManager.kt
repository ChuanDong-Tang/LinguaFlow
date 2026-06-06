package com.yueyantech.oio.chatselectabletext

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

@ReactModule(name = ChatSelectableTextViewManager.NAME)
class ChatSelectableTextViewManager : SimpleViewManager<ChatSelectableTextView>() {
  override fun getName(): String = NAME

  override fun createViewInstance(reactContext: ThemedReactContext): ChatSelectableTextView {
    return ChatSelectableTextView(reactContext)
  }

  @ReactProp(name = "text")
  fun setText(view: ChatSelectableTextView, value: String?) {
    view.setRawText(value ?: "")
  }

  @ReactProp(name = "highlightRangesJson")
  fun setHighlightRangesJson(view: ChatSelectableTextView, value: String?) {
    view.setHighlightRangesJson(value ?: "[]")
  }

  @ReactProp(name = "blankRangesJson")
  fun setBlankRangesJson(view: ChatSelectableTextView, value: String?) {
    view.setBlankRangesJson(value ?: "[]")
  }

  @ReactProp(name = "correctRangesJson")
  fun setCorrectRangesJson(view: ChatSelectableTextView, value: String?) {
    view.setCorrectRangesJson(value ?: "[]")
  }

  @ReactProp(name = "answersVisible", defaultBoolean = false)
  fun setAnswersVisible(view: ChatSelectableTextView, value: Boolean) {
    view.setAnswersVisible(value)
  }

  @ReactProp(name = "menuOptions")
  fun setMenuOptions(view: ChatSelectableTextView, value: ReadableArray?) {
    val options = mutableListOf<String>()
    if (value != null) {
      for (index in 0 until value.size()) {
        options.add(value.getString(index) ?: "")
      }
    }
    view.setMenuOptions(options)
  }

  @ReactProp(name = "selectionMode")
  fun setSelectionMode(view: ChatSelectableTextView, value: String?) {
    view.setSelectionMode(value)
  }

  @ReactProp(name = "textColor")
  fun setTextColor(view: ChatSelectableTextView, value: String?) {
    view.setTextColorValue(value ?: "#111111")
  }

  @ReactProp(name = "fontSize", defaultFloat = 17f)
  fun setFontSize(view: ChatSelectableTextView, value: Float) {
    view.setFontSizeSp(value)
  }

  @ReactProp(name = "lineHeight", defaultFloat = 25f)
  fun setLineHeight(view: ChatSelectableTextView, value: Float) {
    view.setLineHeightSp(value)
  }

  @ReactProp(name = "fontWeight")
  fun setFontWeight(view: ChatSelectableTextView, value: String?) {
    view.setFontWeight(value)
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> {
    return MapBuilder.builder<String, Any>()
      .put("topSelectionStart", MapBuilder.of("registrationName", "onSelectionStart"))
      .put("topTextInteractionStart", MapBuilder.of("registrationName", "onTextInteractionStart"))
      .put("topSelection", MapBuilder.of("registrationName", "onSelection"))
      .put("topClozeRangePress", MapBuilder.of("registrationName", "onClozeRangePress"))
      .put("topClozeRangeLongPress", MapBuilder.of("registrationName", "onClozeRangeLongPress"))
      .build()
  }

  override fun receiveCommand(root: ChatSelectableTextView, commandId: String, args: ReadableArray?) {
    when (commandId) {
      "clearSelection" -> root.clearSelectionState()
      else -> super.receiveCommand(root, commandId, args)
    }
  }

  companion object {
    const val NAME = "ChatSelectableTextView"
  }
}
