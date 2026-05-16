const { withBuildSourceFile } = require("@expo/config-plugins/build/ios/XcodeProjectFile");

const SELECTABLE_MESSAGE_TEXT_MANAGER = String.raw`
#import <UIKit/UIKit.h>
#import <React/RCTBridge.h>
#import <React/RCTConvert.h>
#import <React/RCTUIManager.h>
#import <React/RCTViewManager.h>
#import <React/UIView+React.h>

@interface LFSelectableMessageTextView : UITextView <UITextViewDelegate>
@property (nonatomic, copy) NSString *lfText;
@property (nonatomic, copy) NSArray<NSDictionary *> *highlightRanges;
@property (nonatomic, copy) NSArray<NSDictionary *> *blankRanges;
@property (nonatomic, copy) RCTDirectEventBlock onSelectionChange;
@property (nonatomic, copy) RCTDirectEventBlock onClozeRangePress;
@property (nonatomic, copy) RCTDirectEventBlock onClozeRangeLongPress;
- (void)clearSelection;
@end

@implementation LFSelectableMessageTextView {
  CGFloat _lfFontSize;
  CGFloat _lfLineHeight;
  UIColor *_lfTextColor;
}

- (instancetype)init
{
  if ((self = [super init])) {
    self.delegate = self;
    self.editable = NO;
    self.selectable = YES;
    self.scrollEnabled = NO;
    self.backgroundColor = UIColor.clearColor;
    self.textContainerInset = UIEdgeInsetsZero;
    self.textContainer.lineFragmentPadding = 0;
    self.dataDetectorTypes = UIDataDetectorTypeNone;
    _lfFontSize = 17.0;
    _lfLineHeight = 0.0;
    _lfTextColor = UIColor.blackColor;
    _lfText = @"";

    UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(handleTap:)];
    tap.cancelsTouchesInView = NO;
    [self addGestureRecognizer:tap];
    UILongPressGestureRecognizer *longPress = [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(handleLongPress:)];
    longPress.cancelsTouchesInView = NO;
    [self addGestureRecognizer:longPress];
  }
  return self;
}

- (void)setLfText:(NSString *)lfText
{
  _lfText = [lfText copy] ?: @"";
  [self applyAttributedText];
}

- (void)setHighlightRanges:(NSArray<NSDictionary *> *)highlightRanges
{
  _highlightRanges = [highlightRanges copy] ?: @[];
  [self applyAttributedText];
}

- (void)setBlankRanges:(NSArray<NSDictionary *> *)blankRanges
{
  _blankRanges = [blankRanges copy] ?: @[];
  [self applyAttributedText];
}

- (void)setLfFontSize:(CGFloat)fontSize
{
  _lfFontSize = fontSize > 0 ? fontSize : 17.0;
  [self applyAttributedText];
}

- (void)setLfLineHeight:(CGFloat)lineHeight
{
  _lfLineHeight = lineHeight;
  [self applyAttributedText];
}

- (void)setLfColor:(UIColor *)color
{
  _lfTextColor = color ?: UIColor.blackColor;
  [self applyAttributedText];
}

- (void)applyAttributedText
{
  NSMutableAttributedString *attributed = [[NSMutableAttributedString alloc] initWithString:_lfText ?: @""];
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  if (_lfLineHeight > 0) {
    paragraph.minimumLineHeight = _lfLineHeight;
    paragraph.maximumLineHeight = _lfLineHeight;
  }
  NSDictionary *baseAttributes = @{
    NSFontAttributeName: [UIFont systemFontOfSize:_lfFontSize],
    NSForegroundColorAttributeName: _lfTextColor ?: UIColor.blackColor,
    NSParagraphStyleAttributeName: paragraph,
  };
  [attributed addAttributes:baseAttributes range:NSMakeRange(0, attributed.length)];

  UIColor *highlightColor = [UIColor colorWithRed:1.0 green:242.0 / 255.0 blue:184.0 / 255.0 alpha:1.0];
  for (NSDictionary *range in self.highlightRanges ?: @[]) {
    NSRange nsRange = [self nsRangeFromDictionary:range];
    if (NSMaxRange(nsRange) <= attributed.length && nsRange.length > 0) {
      [attributed addAttribute:NSBackgroundColorAttributeName value:highlightColor range:nsRange];
    }
  }

  for (NSDictionary *range in self.blankRanges ?: @[]) {
    NSRange nsRange = [self nsRangeFromDictionary:range];
    if (NSMaxRange(nsRange) <= attributed.length && nsRange.length > 0) {
      [attributed addAttributes:@{
        NSForegroundColorAttributeName: UIColor.clearColor,
        NSUnderlineStyleAttributeName: @(NSUnderlineStyleSingle),
        NSUnderlineColorAttributeName: _lfTextColor ?: UIColor.blackColor,
      } range:nsRange];
    }
  }

  self.attributedText = attributed;
  [self invalidateIntrinsicContentSize];
}

- (NSRange)nsRangeFromDictionary:(NSDictionary *)range
{
  NSInteger start = [range[@"start"] integerValue];
  NSInteger end = [range[@"end"] integerValue];
  NSInteger length = MAX(0, end - start);
  start = MAX(0, MIN(start, (NSInteger)(_lfText.length)));
  length = MAX(0, MIN(length, (NSInteger)(_lfText.length) - start));
  return NSMakeRange((NSUInteger)start, (NSUInteger)length);
}

- (CGSize)intrinsicContentSize
{
  CGFloat width = CGRectGetWidth(self.bounds);
  if (width <= 0) {
    width = UIViewNoIntrinsicMetric;
  }
  CGSize fitting = [self sizeThatFits:CGSizeMake(width == UIViewNoIntrinsicMetric ? UIScreen.mainScreen.bounds.size.width : width, CGFLOAT_MAX)];
  return CGSizeMake(width, fitting.height);
}

- (void)reactSetFrame:(CGRect)frame
{
  [super reactSetFrame:frame];
  [self invalidateIntrinsicContentSize];
}

- (void)textViewDidChangeSelection:(UITextView *)textView
{
  NSRange selectedRange = textView.selectedRange;
  if (selectedRange.length == 0) {
    [self emitSelectionWithStart:0 end:0 selectedText:@"" endPoint:CGPointZero isBackward:NO];
    return;
  }

  NSUInteger start = selectedRange.location;
  NSUInteger end = selectedRange.location + selectedRange.length;
  NSString *selectedText = @"";
  if (end <= self.text.length) {
    selectedText = [self.text substringWithRange:selectedRange];
  }

  UITextRange *textRange = [textView textRangeFromPosition:[textView positionFromPosition:textView.beginningOfDocument offset:end]
                                                toPosition:[textView positionFromPosition:textView.beginningOfDocument offset:end]];
  CGRect caret = textRange ? [textView firstRectForRange:textRange] : CGRectZero;
  CGPoint screenPoint = [textView convertPoint:CGPointMake(CGRectGetMinX(caret), CGRectGetMaxY(caret)) toView:nil];
  [self emitSelectionWithStart:start end:end selectedText:selectedText endPoint:screenPoint isBackward:NO];
}

- (void)emitSelectionWithStart:(NSUInteger)start
                           end:(NSUInteger)end
                  selectedText:(NSString *)selectedText
                      endPoint:(CGPoint)endPoint
                    isBackward:(BOOL)isBackward
{
  if (!self.onSelectionChange) {
    return;
  }
  self.onSelectionChange(@{
    @"start": @(start),
    @"end": @(end),
    @"selectedText": selectedText ?: @"",
    @"endX": @(endPoint.x),
    @"endY": @(endPoint.y),
    @"isBackward": @(isBackward),
  });
}

- (void)clearSelection
{
  self.selectedRange = NSMakeRange(0, 0);
  [self emitSelectionWithStart:0 end:0 selectedText:@"" endPoint:CGPointZero isBackward:NO];
}

- (void)handleTap:(UITapGestureRecognizer *)gesture
{
  if (gesture.state != UIGestureRecognizerStateEnded) {
    return;
  }
  NSDictionary *range = [self highlightRangeAtPoint:[gesture locationInView:self]];
  if (range && self.onClozeRangePress) {
    self.onClozeRangePress([self eventForHighlightRange:range]);
  }
}

- (void)handleLongPress:(UILongPressGestureRecognizer *)gesture
{
  if (gesture.state != UIGestureRecognizerStateBegan) {
    return;
  }
  NSDictionary *range = [self highlightRangeAtPoint:[gesture locationInView:self]];
  if (range && self.onClozeRangeLongPress) {
    self.onClozeRangeLongPress([self eventForHighlightRange:range]);
  }
}

- (NSDictionary *)highlightRangeAtPoint:(CGPoint)point
{
  NSLayoutManager *layoutManager = self.layoutManager;
  NSTextContainer *textContainer = self.textContainer;
  CGPoint containerPoint = CGPointMake(point.x - self.textContainerInset.left, point.y - self.textContainerInset.top);
  NSUInteger glyphIndex = [layoutManager glyphIndexForPoint:containerPoint inTextContainer:textContainer];
  NSUInteger characterIndex = [layoutManager characterIndexForGlyphAtIndex:glyphIndex];
  for (NSDictionary *range in self.highlightRanges ?: @[]) {
    NSRange nsRange = [self nsRangeFromDictionary:range];
    if (characterIndex >= nsRange.location && characterIndex < NSMaxRange(nsRange)) {
      return range;
    }
  }
  return nil;
}

- (NSDictionary *)eventForHighlightRange:(NSDictionary *)range
{
  return @{
    @"groupIndex": range[@"groupIndex"] ?: @0,
    @"start": range[@"start"] ?: @0,
    @"end": range[@"end"] ?: @0,
  };
}

@end

@interface LFSelectableMessageTextManager : RCTViewManager
@end

@implementation LFSelectableMessageTextManager

RCT_EXPORT_MODULE(LFSelectableMessageText)

- (UIView *)view
{
  return [LFSelectableMessageTextView new];
}

RCT_REMAP_VIEW_PROPERTY(text, lfText, NSString)
RCT_EXPORT_VIEW_PROPERTY(highlightRanges, NSArray)
RCT_EXPORT_VIEW_PROPERTY(blankRanges, NSArray)
RCT_REMAP_VIEW_PROPERTY(fontSize, lfFontSize, CGFloat)
RCT_REMAP_VIEW_PROPERTY(lineHeight, lfLineHeight, CGFloat)
RCT_REMAP_VIEW_PROPERTY(color, lfColor, UIColor)
RCT_EXPORT_VIEW_PROPERTY(onSelectionChange, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onClozeRangePress, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onClozeRangeLongPress, RCTDirectEventBlock)

RCT_EXPORT_METHOD(clearSelection:(nonnull NSNumber *)reactTag)
{
  [self.bridge.uiManager addUIBlock:^(__unused RCTUIManager *uiManager, NSDictionary<NSNumber *, UIView *> *viewRegistry) {
    UIView *view = viewRegistry[reactTag];
    if ([view isKindOfClass:[LFSelectableMessageTextView class]]) {
      [(LFSelectableMessageTextView *)view clearSelection];
    }
  }];
}

@end
`;

const withSelectableMessageTextIOS = (config) => {
  return withBuildSourceFile(config, {
    filePath: "LFSelectableMessageTextManager.m",
    contents: SELECTABLE_MESSAGE_TEXT_MANAGER.trimStart(),
    overwrite: true,
  });
};

module.exports = withSelectableMessageTextIOS;
