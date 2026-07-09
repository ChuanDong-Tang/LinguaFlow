#import <React/RCTUIManager.h>
#import <React/RCTViewManager.h>
#import "ChatSelectableTextView.h"
#import "ChatSelectableTextShadowView.h"

@interface ChatSelectableTextViewManager : RCTViewManager
@end

@implementation ChatSelectableTextViewManager

RCT_EXPORT_MODULE(ChatSelectableTextView)

- (UIView *)view
{
  return [ChatSelectableTextView new];
}

- (RCTShadowView *)shadowView
{
  return [ChatSelectableTextShadowView new];
}

RCT_EXPORT_VIEW_PROPERTY(text, NSString)
RCT_EXPORT_VIEW_PROPERTY(highlightRangesJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(blankRangesJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(correctRangesJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(answersVisible, BOOL)
RCT_EXPORT_VIEW_PROPERTY(textColor, NSString)
RCT_EXPORT_VIEW_PROPERTY(fontSize, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(lineHeight, NSNumber)
RCT_EXPORT_VIEW_PROPERTY(fontWeight, NSString)
RCT_EXPORT_VIEW_PROPERTY(menuOptions, NSArray)
RCT_EXPORT_VIEW_PROPERTY(selectionMode, NSString)
RCT_EXPORT_VIEW_PROPERTY(onContentHeightChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSelectionStart, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSelection, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onClozeRangePress, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onClozeRangeLongPress, RCTDirectEventBlock)

RCT_EXPORT_SHADOW_PROPERTY(text, NSString)
RCT_EXPORT_SHADOW_PROPERTY(blankRangesJson, NSString)
RCT_EXPORT_SHADOW_PROPERTY(answersVisible, BOOL)
RCT_EXPORT_SHADOW_PROPERTY(fontSize, NSNumber)
RCT_EXPORT_SHADOW_PROPERTY(lineHeight, NSNumber)
RCT_EXPORT_SHADOW_PROPERTY(fontWeight, NSString)

RCT_EXPORT_METHOD(clearSelection:(nonnull NSNumber *)reactTag)
{
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *uiManager, NSDictionary<NSNumber *, UIView *> *viewRegistry) {
    UIView *view = viewRegistry[reactTag];
    if ([view isKindOfClass:ChatSelectableTextView.class]) {
      [(ChatSelectableTextView *)view clearSelectionState];
    }
  }];
}

@end
