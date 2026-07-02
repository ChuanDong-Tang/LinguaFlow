#import <UIKit/UIKit.h>
#import <React/RCTComponent.h>

@interface ChatSelectableTextView : UIView

@property (nonatomic, copy) RCTDirectEventBlock onSelectionStart;
@property (nonatomic, copy) RCTDirectEventBlock onSelection;
@property (nonatomic, copy) RCTDirectEventBlock onClozeRangePress;
@property (nonatomic, copy) RCTDirectEventBlock onClozeRangeLongPress;
@property (nonatomic, copy) RCTDirectEventBlock onContentHeightChange;

- (void)setText:(NSString *)text;
- (void)setHighlightRangesJson:(NSString *)json;
- (void)setBlankRangesJson:(NSString *)json;
- (void)setCorrectRangesJson:(NSString *)json;
- (void)setAnswersVisible:(BOOL)visible;
- (void)setTextColor:(NSString *)color;
- (void)setFontSize:(NSNumber *)fontSize;
- (void)setLineHeight:(NSNumber *)lineHeight;
- (void)setFontWeight:(NSString *)fontWeight;
- (void)setMenuOptions:(NSArray<NSString *> *)menuOptions;
- (void)setSelectionMode:(NSString *)selectionMode;
- (void)clearSelectionState;

@end
